import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import type { Currency } from "../../../shared/money";
import { makeAccountRepo } from "../../accounts/infrastructure/accountRepo";
import { makeTransferRepo } from "../infrastructure/transferRepo";
import { makeLedgerRepo } from "../infrastructure/ledgerRepo";
import { makeUserRepo } from "../../identity/infrastructure/userRepo";
import { credit } from "../../accounts/domain/account";
import { AccountNotFoundError } from "../../accounts/domain/errors";
import {
    TransferAmountInvalidError,
    TransferOverLimitError,
} from "../domain/errors";
import type { Transfer } from "../domain/transfer";
import type { MoneyMovedEvent } from "../domain/events";

const FAUCET_MAX_MINOR = 100_000_00; // ₹1,00,000

/**
 * Dev / admin-only "faucet" that credits an account out of nowhere. Models
 * a deposit. Fails in production unless the caller is an admin (the
 * route-level requireRole gates that).
 */
export function faucetDeposit(
    deps: { db: Db; clock: Clock; ids: IdGenerator; bus: EventBus },
    input: {
        toAccountId: string;
        amountMinor: number;
        currency: Currency;
        memo?: string;
        idempotencyKey?: string;
    }
): Transfer {
    if (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor))
        throw new TransferAmountInvalidError();
    if (input.amountMinor > FAUCET_MAX_MINOR) throw new TransferOverLimitError(FAUCET_MAX_MINOR);

    const events: MoneyMovedEvent[] = [];

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

        const to = accountRepo.findById(input.toAccountId);
        if (!to) throw new AccountNotFoundError();

        const now = deps.clock.now();
        const credited = credit(to, input.amountMinor, input.currency, now);
        const toUser = userRepo.findById(to.userId);

        const newTransfer: Transfer = {
            id: deps.ids.uuid(),
            idempotencyKey: input.idempotencyKey,
            fromAccountId: undefined,
            toAccountId: credited.id,
            amountMinor: input.amountMinor,
            currency: input.currency,
            memo: input.memo ?? "Faucet deposit",
            kind: "faucet",
            status: "posted",
            postedAt: now,
            referenceNumber: deps.ids.transactionReference(),
            feeMinor: 0,
            category: "faucet",
            fromAccountNumber: undefined,
            toAccountNumber: to.accountNumber,
            fromUsername: "Sentinel Bank (faucet)",
            toUsername: toUser?.username,
            description: input.memo ?? "Faucet deposit",
        };

        transferRepo.insert(newTransfer);
        accountRepo.update(credited);
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
            toAccountId: credited.id,
            amountMinor: input.amountMinor,
            currency: input.currency,
            kind: "faucet",
            postedAt: now,
        });
        return newTransfer;
    });

    if (events.length > 0) deps.bus.publish(events);
    return transfer;
}
