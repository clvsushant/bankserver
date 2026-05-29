import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import { makeAccountRepo } from "../../accounts/infrastructure/accountRepo";
import { makeTransferRepo } from "../infrastructure/transferRepo";
import { makeLedgerRepo } from "../infrastructure/ledgerRepo";
import { credit, debit, releaseHold } from "../../accounts/domain/account";
import type { TransferRail } from "../domain/transfer";
import type { MoneyMovedEvent } from "../domain/events";

export interface SettleResult {
    readonly settled: number;
    readonly failed: number;
}

/**
 * Batch-settles pending NEFT/RTGS transfers: releases hold, debits source,
 * credits destination, posts ledger entries.
 */
export function settlePendingTransfers(
    deps: { db: Db; clock: Clock; ids: IdGenerator; bus: EventBus },
    rail: Extract<TransferRail, "neft" | "rtgs">
): SettleResult {
    const pending = makeTransferRepo(deps.db).listPendingByRail(rail);
    let settled = 0;
    let failed = 0;
    const events: MoneyMovedEvent[] = [];

    for (const t of pending) {
        try {
            deps.db.transaction((tx) => {
                const txDb = tx as unknown as Db;
                const accountRepo = makeAccountRepo(txDb);
                const transferRepo = makeTransferRepo(txDb);
                const ledgerRepo = makeLedgerRepo(txDb);
                const now = deps.clock.now();

                const current = transferRepo.findById(t.id);
                if (!current || current.status !== "pending") return;
                const from = current.fromAccountId
                    ? accountRepo.findById(current.fromAccountId)
                    : undefined;
                const to = current.toAccountId
                    ? accountRepo.findById(current.toAccountId)
                    : undefined;
                if (!from || !to) throw new Error("Accounts missing for pending transfer");

                const released = releaseHold(from, current.amountMinor, now);
                const debited = debit(released, current.amountMinor, current.currency, now);
                const credited = credit(to, current.amountMinor, current.currency, now);

                transferRepo.settlePending(current.id, {
                    status: "posted",
                    utr: current.utr,
                    postedAt: now,
                });
                accountRepo.update(debited);
                accountRepo.update(credited);
                ledgerRepo.insert({
                    id: deps.ids.uuid(),
                    accountId: debited.id,
                    transferId: current.id,
                    kind: "debit",
                    amountMinor: current.amountMinor,
                    runningBalanceMinor: debited.balanceMinor,
                    postedAt: now,
                });
                ledgerRepo.insert({
                    id: deps.ids.uuid(),
                    accountId: credited.id,
                    transferId: current.id,
                    kind: "credit",
                    amountMinor: current.amountMinor,
                    runningBalanceMinor: credited.balanceMinor,
                    postedAt: now,
                });

                events.push({
                    type: "MoneyMoved",
                    transferId: current.id,
                    fromAccountId: debited.id,
                    toAccountId: credited.id,
                    amountMinor: current.amountMinor,
                    currency: current.currency,
                    kind: "transfer",
                    postedAt: now,
                });
            });
            settled += 1;
        } catch {
            failed += 1;
        }
    }

    if (events.length > 0) deps.bus.publish(events);
    return { settled, failed };
}
