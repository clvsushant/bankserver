import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import type { Currency } from "../../../shared/money";
import { makeAccountRepo } from "../../accounts/infrastructure/accountRepo";
import { makeTransferRepo } from "../../payments/infrastructure/transferRepo";
import { makeLedgerRepo } from "../../payments/infrastructure/ledgerRepo";
import { makeUserRepo } from "../../identity/infrastructure/userRepo";
import { makeBillerRepo } from "../../bills/infrastructure/billerRepo";
import { credit, debit } from "../../accounts/domain/account";
import { AccountNotFoundError } from "../../accounts/domain/errors";
import { TransferAmountInvalidError } from "../../payments/domain/errors";
import type { Transfer } from "../../payments/domain/transfer";
import type { DomainEvent } from "../../../shared/eventBus";
import type { MoneyMovedEvent } from "../../payments/domain/events";
import type { CardSpentEvent } from "../domain/events";
import { assertBankingAccess } from "../../kyc/application/bankingAccess";
import { makeKycRepo } from "../../kyc/infrastructure/kycRepo";
import {
    CARD_MERCHANT_BILLER_NAME,
    checkCardLimits,
} from "../../../services/cardLimits";
import {
    CardInvalidStateError,
    CardLimitExceededError,
    CardMerchantNotConfiguredError,
    CardNotFoundError,
    CardPerTxnLimitError,
} from "../domain/errors";
import type { DebitCardRepo } from "./ports";
import type { AccountRepo } from "../../accounts/application/ports";
import type { BillerRepo } from "../../bills/application/ports";

export interface SimulateCardSpendInput {
    ownerUserId: string;
    cardId: string;
    amountMinor: number;
    currency: Currency;
    merchantName?: string;
    idempotencyKey?: string;
}

export function simulateCardSpend(
    deps: {
        db: Db;
        clock: Clock;
        ids: IdGenerator;
        bus: EventBus;
        cards: DebitCardRepo;
        accounts: AccountRepo;
        billers: BillerRepo;
    },
    input: SimulateCardSpendInput
): Transfer {
    if (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor))
        throw new TransferAmountInvalidError();

    assertBankingAccess(
        { kyc: makeKycRepo(deps.db), accounts: makeAccountRepo(deps.db) },
        input.ownerUserId
    );

    const card = deps.cards.findById(input.cardId);
    if (!card) throw new CardNotFoundError();
    const from = deps.accounts.findById(card.accountId);
    if (!from || from.userId !== input.ownerUserId) throw new CardNotFoundError();
    if (card.status !== "active") throw new CardInvalidStateError(card.status, "spend");

    const merchant = deps.billers.listAll().find((b) => b.name === CARD_MERCHANT_BILLER_NAME);
    if (!merchant || !merchant.active) throw new CardMerchantNotConfiguredError();
    const to = deps.accounts.findByAccountNumber(merchant.billerAccountNumber);
    if (!to) throw new CardMerchantNotConfiguredError();

    const now = deps.clock.now();
    const limits = {
        perTxnLimitMinor: card.perTxnLimitMinor,
        dailyLimitMinor: card.dailyLimitMinor,
        monthlyLimitMinor: card.monthlyLimitMinor,
    };
    const limitCheck = checkCardLimits(deps.db, {
        cardId: card.id,
        amountMinor: input.amountMinor,
        limits,
        now,
    });
    if (!limitCheck.allowed) {
        if (limitCheck.reason === "Per-transaction card limit exceeded")
            throw new CardPerTxnLimitError();
        throw new CardLimitExceededError(limitCheck.reason ?? "Card limit exceeded");
    }

    const events: DomainEvent[] = [];
    const merchantLabel = input.merchantName?.trim() || "Card merchant";

    const transfer = deps.db.transaction((tx): Transfer => {
        const txDb = tx as unknown as Db;
        const accountRepo = makeAccountRepo(txDb);
        const transferRepo = makeTransferRepo(txDb);
        const ledgerRepo = makeLedgerRepo(txDb);
        const userRepo = makeUserRepo(txDb);

        if (input.idempotencyKey) {
            const prior = transferRepo.findByIdempotencyKey(input.idempotencyKey);
            if (prior) return prior;
        }

        const fromAcc = accountRepo.findById(from.id);
        const toAcc = accountRepo.findByAccountNumber(to.accountNumber);
        if (!fromAcc || !toAcc) throw new AccountNotFoundError();

        const debited = debit(fromAcc, input.amountMinor, input.currency, now);
        const credited = credit(toAcc, input.amountMinor, input.currency, now);
        const fromUser = userRepo.findById(fromAcc.userId);

        const newTransfer: Transfer = {
            id: deps.ids.uuid(),
            idempotencyKey: input.idempotencyKey,
            fromAccountId: debited.id,
            toAccountId: credited.id,
            amountMinor: input.amountMinor,
            currency: input.currency,
            memo: input.merchantName,
            kind: "transfer",
            status: "posted",
            rail: "internal",
            postedAt: now,
            referenceNumber: deps.ids.transactionReference(),
            feeMinor: 0,
            category: "card",
            cardId: card.id,
            fromAccountNumber: fromAcc.accountNumber,
            toAccountNumber: toAcc.accountNumber,
            fromUsername: fromUser?.username,
            toUsername: merchantLabel,
            description: `Card payment to ${merchantLabel}`,
        };

        transferRepo.insert(newTransfer);
        accountRepo.update(debited);
        accountRepo.update(credited);
        ledgerRepo.insert({
            id: deps.ids.uuid(),
            accountId: debited.id,
            transferId: newTransfer.id,
            kind: "debit",
            amountMinor: input.amountMinor,
            runningBalanceMinor: debited.balanceMinor,
            postedAt: now,
        });
        ledgerRepo.insert({
            id: deps.ids.uuid(),
            accountId: credited.id,
            transferId: newTransfer.id,
            kind: "credit",
            amountMinor: input.amountMinor,
            runningBalanceMinor: credited.balanceMinor,
            postedAt: now,
        });

        const moneyMoved: MoneyMovedEvent = {
            type: "MoneyMoved",
            transferId: newTransfer.id,
            fromAccountId: debited.id,
            toAccountId: credited.id,
            amountMinor: input.amountMinor,
            currency: input.currency,
            kind: "transfer",
            postedAt: now,
        };
        events.push(moneyMoved);
        return newTransfer;
    });

    if (events.length > 0) {
        const cardSpent: CardSpentEvent = {
            type: "CardSpent",
            cardId: card.id,
            ownerUserId: input.ownerUserId,
            transferId: transfer.id,
            amountMinor: input.amountMinor,
            currency: input.currency,
            merchantName: merchantLabel,
            spentAt: now,
        };
        deps.bus.publish([...events, cardSpent]);
    }
    return transfer;
}
