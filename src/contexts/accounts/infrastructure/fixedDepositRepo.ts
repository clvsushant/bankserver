import { and, eq, lte } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { fixedDeposits } from "../../../db/schema";
import type { FixedDeposit, FixedDepositStatus } from "../domain/fixedDeposit";
import type { FixedDepositRepo } from "../application/ports";

function toDomain(row: typeof fixedDeposits.$inferSelect): FixedDeposit {
    return {
        id: row.id,
        accountId: row.accountId,
        userId: row.userId,
        payoutAccountId: row.payoutAccountId,
        principalMinor: row.principalMinor,
        tenureMonths: row.tenureMonths,
        interestRateBps: row.interestRateBps,
        openedAt: row.openedAt,
        maturityAt: row.maturityAt,
        autoRenew: row.autoRenew,
        status: row.status as FixedDepositStatus,
        closedAt: row.closedAt ?? undefined,
        interestPaidMinor: row.interestPaidMinor,
    };
}

export function makeFixedDepositRepo(db: Db): FixedDepositRepo {
    return {
        findById(id) {
            const [row] = db
                .select()
                .from(fixedDeposits)
                .where(eq(fixedDeposits.id, id))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        findByAccountId(accountId) {
            const [row] = db
                .select()
                .from(fixedDeposits)
                .where(eq(fixedDeposits.accountId, accountId))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listActiveByUserId(userId) {
            const rows = db
                .select()
                .from(fixedDeposits)
                .where(and(eq(fixedDeposits.userId, userId), eq(fixedDeposits.status, "active")))
                .all();
            return rows.map(toDomain);
        },
        listByUserId(userId) {
            const rows = db
                .select()
                .from(fixedDeposits)
                .where(eq(fixedDeposits.userId, userId))
                .all();
            return rows.map(toDomain);
        },
        listDueForMaturity(now) {
            const rows = db
                .select()
                .from(fixedDeposits)
                .where(
                    and(
                        eq(fixedDeposits.status, "active"),
                        lte(fixedDeposits.maturityAt, now)
                    )
                )
                .all();
            return rows.map(toDomain);
        },
        insert(fd) {
            db.insert(fixedDeposits)
                .values({
                    id: fd.id,
                    accountId: fd.accountId,
                    userId: fd.userId,
                    payoutAccountId: fd.payoutAccountId,
                    principalMinor: fd.principalMinor,
                    tenureMonths: fd.tenureMonths,
                    interestRateBps: fd.interestRateBps,
                    openedAt: fd.openedAt,
                    maturityAt: fd.maturityAt,
                    autoRenew: fd.autoRenew,
                    status: fd.status,
                    closedAt: fd.closedAt ?? null,
                    interestPaidMinor: fd.interestPaidMinor,
                })
                .run();
        },
        update(fd) {
            db.update(fixedDeposits)
                .set({
                    status: fd.status,
                    closedAt: fd.closedAt ?? null,
                    interestPaidMinor: fd.interestPaidMinor,
                })
                .where(eq(fixedDeposits.id, fd.id))
                .run();
        },
    };
}
