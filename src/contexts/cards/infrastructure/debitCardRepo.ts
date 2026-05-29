import { desc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { debitCards } from "../../../db/schema";
import type { CardNetwork, CardStatus, DebitCard } from "../domain/card";
import type { DebitCardRepo } from "../application/ports";

function toDomain(row: typeof debitCards.$inferSelect): DebitCard {
    return {
        id: row.id,
        accountId: row.accountId,
        maskedNumber: row.maskedNumber,
        network: row.network as CardNetwork,
        status: row.status as CardStatus,
        issuedAt: row.issuedAt,
        frozenAt: row.frozenAt ?? undefined,
        cancelledAt: row.cancelledAt ?? undefined,
        perTxnLimitMinor: row.perTxnLimitMinor,
        dailyLimitMinor: row.dailyLimitMinor,
        monthlyLimitMinor: row.monthlyLimitMinor,
    };
}

export function makeDebitCardRepo(db: Db): DebitCardRepo {
    return {
        findById(id) {
            const [row] = db.select().from(debitCards).where(eq(debitCards.id, id)).limit(1).all();
            return row ? toDomain(row) : undefined;
        },
        listByAccount(accountId) {
            const rows = db
                .select()
                .from(debitCards)
                .where(eq(debitCards.accountId, accountId))
                .orderBy(desc(debitCards.issuedAt))
                .all();
            return rows.map(toDomain);
        },
        insert(card) {
            db.insert(debitCards)
                .values({
                    id: card.id,
                    accountId: card.accountId,
                    maskedNumber: card.maskedNumber,
                    network: card.network,
                    status: card.status,
                    issuedAt: card.issuedAt,
                    frozenAt: card.frozenAt ?? null,
                    cancelledAt: card.cancelledAt ?? null,
                    perTxnLimitMinor: card.perTxnLimitMinor,
                    dailyLimitMinor: card.dailyLimitMinor,
                    monthlyLimitMinor: card.monthlyLimitMinor,
                })
                .run();
        },
        update(card) {
            db.update(debitCards)
                .set({
                    status: card.status,
                    frozenAt: card.frozenAt ?? null,
                    cancelledAt: card.cancelledAt ?? null,
                    perTxnLimitMinor: card.perTxnLimitMinor,
                    dailyLimitMinor: card.dailyLimitMinor,
                    monthlyLimitMinor: card.monthlyLimitMinor,
                })
                .where(eq(debitCards.id, card.id))
                .run();
        },
    };
}
