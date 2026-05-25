import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { ledgerEntries } from "../../../db/schema";
import type { LedgerEntry } from "../domain/transfer";
import type { LedgerRepo } from "../application/ports";

function toDomain(row: typeof ledgerEntries.$inferSelect): LedgerEntry {
    return {
        id: row.id,
        accountId: row.accountId,
        transferId: row.transferId,
        kind: row.kind as "debit" | "credit",
        amountMinor: row.amountMinor,
        runningBalanceMinor: row.runningBalanceMinor,
        postedAt: row.postedAt,
    };
}

export function makeLedgerRepo(db: Db): LedgerRepo {
    return {
        insert(e) {
            db.insert(ledgerEntries)
                .values({
                    id: e.id,
                    accountId: e.accountId,
                    transferId: e.transferId,
                    kind: e.kind,
                    amountMinor: e.amountMinor,
                    runningBalanceMinor: e.runningBalanceMinor,
                    postedAt: e.postedAt,
                })
                .run();
        },
        listByAccountIdInRange(accountId, fromMs, toMs) {
            const rows = db
                .select()
                .from(ledgerEntries)
                .where(
                    and(
                        eq(ledgerEntries.accountId, accountId),
                        gte(ledgerEntries.postedAt, new Date(fromMs)),
                        lt(ledgerEntries.postedAt, new Date(toMs))
                    )
                )
                .orderBy(asc(ledgerEntries.postedAt))
                .all();
            return rows.map(toDomain);
        },
        listByAccountId(accountId, limit) {
            const rows = db
                .select()
                .from(ledgerEntries)
                .where(eq(ledgerEntries.accountId, accountId))
                .orderBy(desc(ledgerEntries.postedAt))
                .limit(limit)
                .all();
            return rows.map(toDomain);
        },
        listByTransferId(transferId) {
            const rows = db
                .select()
                .from(ledgerEntries)
                .where(eq(ledgerEntries.transferId, transferId))
                .orderBy(asc(ledgerEntries.postedAt))
                .all();
            return rows.map(toDomain);
        },
    };
}
