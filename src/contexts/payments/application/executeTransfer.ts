import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import type { Currency } from "../../../shared/money";
import { makeAccountRepo } from "../../accounts/infrastructure/accountRepo";
import { makeTransferRepo } from "../infrastructure/transferRepo";
import { makeLedgerRepo } from "../infrastructure/ledgerRepo";
import { makeUserRepo } from "../../identity/infrastructure/userRepo";
import { makeBeneficiaryRepo } from "../../beneficiaries/infrastructure/beneficiaryRepo";
import { makeKycRepo } from "../../kyc/infrastructure/kycRepo";
import { assertBankingAccess } from "../../kyc/application/bankingAccess";
import { credit, debit } from "../../accounts/domain/account";
import { AccountNotFoundError } from "../../accounts/domain/errors";
import { isTransferAllowed } from "../../beneficiaries/domain/beneficiary";
import { BeneficiaryCoolingPeriodError } from "../../beneficiaries/domain/errors";
import {
    CrossUserFixedDepositTransferError,
    TransferAggregateLimitError,
    TransferAmountInvalidError,
    TransferOverLimitError,
    TransferToSelfError,
} from "../domain/errors";
import type { Transfer, TransferRail } from "../domain/transfer";
import type { MoneyMovedEvent } from "../domain/events";
import { checkAggregateLimits, type KycTier } from "../../../services/transferLimits";
import type { BeneficiaryRepo } from "../../beneficiaries/application/ports";

const PER_TRANSACTION_MAX_MINOR = 1_000_000_00; // ₹10,00,000 (10 lakh)

export interface ExecuteTransferInput {
    fromAccountId: string;
    toAccountNumber: string;
    amountMinor: number;
    currency: Currency;
    memo?: string;
    idempotencyKey?: string;
    beneficiaryId?: string;
    ownerUserId?: string;
    kycTier?: KycTier;
    rail?: TransferRail;
}

export function executeTransfer(
    deps: {
        db: Db;
        clock: Clock;
        ids: IdGenerator;
        bus: EventBus;
        beneficiaries?: BeneficiaryRepo;
    },
    input: ExecuteTransferInput
): Transfer {
    if (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor))
        throw new TransferAmountInvalidError();
    if (input.amountMinor > PER_TRANSACTION_MAX_MINOR)
        throw new TransferOverLimitError(PER_TRANSACTION_MAX_MINOR);

    if (input.ownerUserId) {
        assertBankingAccess(
            {
                kyc: makeKycRepo(deps.db),
                accounts: makeAccountRepo(deps.db),
            },
            input.ownerUserId
        );
    }
    if (input.kycTier === "none") {
        throw new TransferAggregateLimitError("KYC verification required before transfers");
    }

    const events: MoneyMovedEvent[] = [];
    const rail: TransferRail = input.rail ?? "internal";

    const transfer = deps.db.transaction((tx): Transfer => {
        const txDb = tx as unknown as Db;
        const accountRepo = makeAccountRepo(txDb);
        const transferRepo = makeTransferRepo(txDb);
        const ledgerRepo = makeLedgerRepo(txDb);
        const userRepo = makeUserRepo(txDb);
        const beneficiaryRepo = deps.beneficiaries ?? makeBeneficiaryRepo(txDb);

        if (input.idempotencyKey) {
            const prior = transferRepo.findByIdempotencyKey(input.idempotencyKey);
            if (prior) return prior;
        }

        const from = accountRepo.findById(input.fromAccountId);
        if (!from) throw new AccountNotFoundError();
        const to = accountRepo.findByAccountNumber(input.toAccountNumber);
        if (!to) throw new AccountNotFoundError();
        if (from.id === to.id) throw new TransferToSelfError();

        if (to.accountType === "fixed_deposit" && from.userId !== to.userId) {
            throw new CrossUserFixedDepositTransferError();
        }

        const now = deps.clock.now();

        if (input.beneficiaryId && input.ownerUserId) {
            const b = beneficiaryRepo.findById(input.beneficiaryId);
            if (!b || b.ownerUserId !== input.ownerUserId)
                throw new BeneficiaryCoolingPeriodError();
            if (!isTransferAllowed(b, now)) throw new BeneficiaryCoolingPeriodError();
        }

        if (input.ownerUserId && input.kycTier) {
            const myAccounts = accountRepo.listByUserId(input.ownerUserId);
            const limitCheck = checkAggregateLimits(txDb, {
                userId: input.ownerUserId,
                accountIds: myAccounts.map((a) => a.id),
                amountMinor: input.amountMinor,
                kycTier: input.kycTier,
                now,
            });
            if (!limitCheck.allowed)
                throw new TransferAggregateLimitError(limitCheck.reason ?? "Transfer limit exceeded");
        }

        const debited = debit(from, input.amountMinor, input.currency, now);
        const credited = credit(to, input.amountMinor, input.currency, now);

        const fromUser = userRepo.findById(from.userId);
        const toUser = userRepo.findById(to.userId);
        const category = from.userId === to.userId ? "self" : "p2p";
        const description =
            category === "self"
                ? `Self transfer to ${to.accountNumber}`
                : `Sent to ${toUser?.username ?? to.accountNumber}`;

        const newTransfer: Transfer = {
            id: deps.ids.uuid(),
            idempotencyKey: input.idempotencyKey,
            fromAccountId: debited.id,
            toAccountId: credited.id,
            amountMinor: input.amountMinor,
            currency: input.currency,
            memo: input.memo,
            kind: "transfer",
            status: "posted",
            rail,
            postedAt: now,
            referenceNumber: deps.ids.transactionReference(),
            feeMinor: 0,
            category,
            fromAccountNumber: from.accountNumber,
            toAccountNumber: to.accountNumber,
            fromUsername: fromUser?.username,
            toUsername: toUser?.username,
            description,
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

        events.push({
            type: "MoneyMoved",
            transferId: newTransfer.id,
            fromAccountId: debited.id,
            toAccountId: credited.id,
            amountMinor: input.amountMinor,
            currency: input.currency,
            kind: "transfer",
            postedAt: now,
        });
        return newTransfer;
    });

    if (events.length > 0) deps.bus.publish(events);
    return transfer;
}
