import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import type { Currency } from "../../../shared/money";
import { makeAccountRepo } from "../../accounts/infrastructure/accountRepo";
import { makeTransferRepo } from "../../payments/infrastructure/transferRepo";
import { makeLedgerRepo } from "../../payments/infrastructure/ledgerRepo";
import { makeUserRepo } from "../../identity/infrastructure/userRepo";
import { makeBillerRepo } from "../infrastructure/billerRepo";
import { makeKycRepo } from "../../kyc/infrastructure/kycRepo";
import { assertBankingAccess } from "../../kyc/application/bankingAccess";
import { credit, debit } from "../../accounts/domain/account";
import { AccountNotFoundError } from "../../accounts/domain/errors";
import {
    TransferAmountInvalidError,
    TransferOverLimitError,
} from "../../payments/domain/errors";
import type { Transfer } from "../../payments/domain/transfer";
import type { MoneyMovedEvent } from "../../payments/domain/events";
import type { BillPaidEvent } from "../domain/events";
import type { DomainEvent } from "../../../shared/eventBus";
import { BillerInactiveError, BillerNotFoundError } from "../domain/errors";

const PER_BILL_MAX_MINOR = 500_000_00; // ₹5,00,000 cap per single bill payment

export interface PayBillInput {
    fromAccountId: string;
    billerId: string;
    amountMinor: number;
    currency: Currency;
    customerRef?: string;
    idempotencyKey?: string;
    ownerUserId: string;
}

export function payBill(
    deps: { db: Db; clock: Clock; ids: IdGenerator; bus: EventBus },
    input: PayBillInput
): Transfer {
    if (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor))
        throw new TransferAmountInvalidError();
    if (input.amountMinor > PER_BILL_MAX_MINOR)
        throw new TransferOverLimitError(PER_BILL_MAX_MINOR);

    assertBankingAccess(
        {
            kyc: makeKycRepo(deps.db),
            accounts: makeAccountRepo(deps.db),
        },
        input.ownerUserId
    );

    const events: DomainEvent[] = [];

    const transfer = deps.db.transaction((tx): Transfer => {
        const txDb = tx as unknown as Db;
        const accountRepo = makeAccountRepo(txDb);
        const transferRepo = makeTransferRepo(txDb);
        const ledgerRepo = makeLedgerRepo(txDb);
        const userRepo = makeUserRepo(txDb);
        const billerRepo = makeBillerRepo(txDb);

        if (input.idempotencyKey) {
            const prior = transferRepo.findByIdempotencyKey(input.idempotencyKey);
            if (prior) return prior;
        }

        const biller = billerRepo.findById(input.billerId);
        if (!biller) throw new BillerNotFoundError();
        if (!biller.active) throw new BillerInactiveError();

        const from = accountRepo.findById(input.fromAccountId);
        if (!from) throw new AccountNotFoundError();
        const to = accountRepo.findByAccountNumber(biller.billerAccountNumber);
        if (!to) throw new AccountNotFoundError();

        const now = deps.clock.now();
        const debited = debit(from, input.amountMinor, input.currency, now);
        const credited = credit(to, input.amountMinor, input.currency, now);

        const fromUser = userRepo.findById(from.userId);
        const description = input.customerRef
            ? `${biller.name} bill payment (${input.customerRef})`
            : `${biller.name} bill payment`;

        const newTransfer: Transfer = {
            id: deps.ids.uuid(),
            idempotencyKey: input.idempotencyKey,
            fromAccountId: debited.id,
            toAccountId: credited.id,
            amountMinor: input.amountMinor,
            currency: input.currency,
            memo: input.customerRef,
            kind: "transfer",
            status: "posted",
            rail: "internal",
            postedAt: now,
            referenceNumber: deps.ids.transactionReference(),
            feeMinor: 0,
            category: "bill",
            fromAccountNumber: from.accountNumber,
            toAccountNumber: to.accountNumber,
            fromUsername: fromUser?.username,
            toUsername: biller.name,
            description,
            billerId: biller.id,
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
        const billPaid: BillPaidEvent = {
            type: "BillPaid",
            transferId: newTransfer.id,
            billerId: biller.id,
            fromAccountId: debited.id,
            fromUserId: from.userId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            customerRef: input.customerRef,
            paidAt: now,
        };
        events.push(moneyMoved, billPaid);
        return newTransfer;
    });

    if (events.length > 0) deps.bus.publish(events);
    return transfer;
}
