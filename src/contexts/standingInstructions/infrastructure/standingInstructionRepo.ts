import { and, asc, eq, lte } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { standingInstructions } from "../../../db/schema";
import type {
    SiFrequency,
    SiStatus,
    StandingInstruction,
} from "../domain/standingInstruction";
import type { Currency } from "../../../shared/money";
import type { StandingInstructionRepo } from "../application/ports";

function toDomain(row: typeof standingInstructions.$inferSelect): StandingInstruction {
    return {
        id: row.id,
        ownerUserId: row.ownerUserId,
        fromAccountId: row.fromAccountId,
        beneficiaryId: row.beneficiaryId,
        amountMinor: row.amountMinor,
        currency: row.currency as Currency,
        frequency: row.frequency as SiFrequency,
        nextRunAt: row.nextRunAt,
        lastRunAt: row.lastRunAt ?? undefined,
        status: row.status as SiStatus,
        description: row.description ?? undefined,
        endAt: row.endAt ?? undefined,
        failureCount: row.failureCount ?? 0,
        createdAt: row.createdAt,
    };
}

export function makeStandingInstructionRepo(db: Db): StandingInstructionRepo {
    return {
        findById(id) {
            const [row] = db
                .select()
                .from(standingInstructions)
                .where(eq(standingInstructions.id, id))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listByOwner(ownerUserId) {
            const rows = db
                .select()
                .from(standingInstructions)
                .where(eq(standingInstructions.ownerUserId, ownerUserId))
                .orderBy(asc(standingInstructions.nextRunAt))
                .all();
            return rows.map(toDomain);
        },
        listDue(now) {
            const rows = db
                .select()
                .from(standingInstructions)
                .where(
                    and(
                        eq(standingInstructions.status, "active"),
                        lte(standingInstructions.nextRunAt, now)
                    )
                )
                .orderBy(asc(standingInstructions.nextRunAt))
                .all();
            return rows.map(toDomain);
        },
        insert(si) {
            db.insert(standingInstructions)
                .values({
                    id: si.id,
                    ownerUserId: si.ownerUserId,
                    fromAccountId: si.fromAccountId,
                    beneficiaryId: si.beneficiaryId,
                    amountMinor: si.amountMinor,
                    currency: si.currency,
                    frequency: si.frequency,
                    nextRunAt: si.nextRunAt,
                    lastRunAt: si.lastRunAt ?? null,
                    status: si.status,
                    description: si.description ?? null,
                    endAt: si.endAt ?? null,
                    failureCount: si.failureCount,
                    createdAt: si.createdAt,
                })
                .run();
        },
        update(si) {
            db.update(standingInstructions)
                .set({
                    nextRunAt: si.nextRunAt,
                    lastRunAt: si.lastRunAt ?? null,
                    status: si.status,
                    failureCount: si.failureCount,
                })
                .where(eq(standingInstructions.id, si.id))
                .run();
        },
        setStatus(id, status) {
            db.update(standingInstructions)
                .set({ status })
                .where(eq(standingInstructions.id, id))
                .run();
        },
    };
}
