import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import type { Currency } from "../../../shared/money";
import { makeAccountRepo } from "../../accounts/infrastructure/accountRepo";
import { makeTransferRepo } from "../infrastructure/transferRepo";
import { makeLedgerRepo } from "../infrastructure/ledgerRepo";
import { makeUserRepo } from "../../identity/infrastructure/userRepo";
import { credit, debit } from "../../accounts/domain/account";
import { AccountNotFoundError } from "../../accounts/domain/errors";
import {
    CrossUserFixedDepositTransferError,
    TransferAmountInvalidError,
    TransferOverLimitError,
    TransferToSelfError,
} from "../domain/errors";
import type { Transfer } from "../domain/transfer";
import type { MoneyMovedEvent } from "../domain/events";

const PER_TRANSACTION_MAX_MINOR = 1_000_000_00; // ₹10,00,000 (10 lakh)

export interface ExecuteTransferInput {
    fromAccountId: string;
    toAccountNumber: string;
    amountMinor: number;
    currency: Currency;
    memo?: string;
    idempotencyKey?: string;
}

/**
 * Posts a transfer atomically:
 *
 *   - validates inputs and looks up both accounts
 *   - debits source, credits target via the Account aggregate
 *   - inserts ONE transfers row + TWO ledger_entries rows
 *   - updates both account balances
 *
 * All inside a SQL transaction. On any error the SQL transaction is rolled
 * back and the use case throws.
 *
 * Idempotency: if `idempotencyKey` is supplied AND a previous transfer with
 * the same key exists, the existing transfer is returned without effects.
 */
export function executeTransfer(
    deps: { db: Db; clock: Clock; ids: IdGenerator; bus: EventBus },
    input: ExecuteTransferInput
): Transfer {
    if (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor))
        throw new TransferAmountInvalidError();
    if (input.amountMinor > PER_TRANSACTION_MAX_MINOR)
        throw new TransferOverLimitError(PER_TRANSACTION_MAX_MINOR);

    const events: MoneyMovedEvent[] = [];

    const transfer = deps.db.transaction((tx): Transfer => {
        // Drizzle's tx and db have identical query APIs but different TS
        // types. Cast lets repos take the top-level Db type.
        const txDb = tx as unknown as Db;
        const accountRepo = makeAccountRepo(txDb);
        const transferRepo = makeTransferRepo(txDb);
        const ledgerRepo = makeLedgerRepo(txDb);
        const userRepo = makeUserRepo(txDb);

        if (input.idempotencyKey) {
            const prior = transferRepo.findByIdempotencyKey(input.idempotencyKey);
            if (prior) return prior;
        }

        const from = accountRepo.findById(input.fromAccountId);
        if (!from) throw new AccountNotFoundError();
        const to = accountRepo.findByAccountNumber(input.toAccountNumber);
        if (!to) throw new AccountNotFoundError();
        if (from.id === to.id) throw new TransferToSelfError();

        // Funding a Fixed Deposit is restricted to self transfers. Regardless
        // of the source account type (savings or current), pushing money into
        // someone else's FD is disallowed; you may still fund your own FD
        // from any of your own accounts.
        if (to.accountType === "fixed_deposit" && from.userId !== to.userId) {
            throw new CrossUserFixedDepositTransferError();
        }

        const now = deps.clock.now();
        const debited = debit(from, input.amountMinor, input.currency, now);
        const credited = credit(to, input.amountMinor, input.currency, now);

        // Snapshot counterparty info inline so the receipt is point-in-time
        // consistent even if usernames or account numbers change later.
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
