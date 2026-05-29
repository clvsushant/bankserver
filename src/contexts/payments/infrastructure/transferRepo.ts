import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { transfers } from "../../../db/schema";
import type {
    Transfer,
    TransferCategory,
    TransferKind,
    TransferRail,
    TransferStatus,
} from "../domain/transfer";
import type { Currency } from "../../../shared/money";
import type { TransferRepo } from "../application/ports";

function toDomain(row: typeof transfers.$inferSelect): Transfer {
    return {
        id: row.id,
        idempotencyKey: row.idempotencyKey ?? undefined,
        fromAccountId: row.fromAccountId ?? undefined,
        toAccountId: row.toAccountId ?? undefined,
        amountMinor: row.amountMinor,
        currency: row.currency as Currency,
        memo: row.memo ?? undefined,
        kind: row.kind as TransferKind,
        status: row.status as TransferStatus,
        rail: (row.rail as TransferRail) ?? "internal",
        utr: row.utr ?? undefined,
        failureReason: row.failureReason ?? undefined,
        postedAt: row.postedAt,
        referenceNumber: row.referenceNumber ?? undefined,
        feeMinor: row.feeMinor ?? 0,
        category: (row.category as TransferCategory | null) ?? undefined,
        fromAccountNumber: row.fromAccountNumber ?? undefined,
        toAccountNumber: row.toAccountNumber ?? undefined,
        fromUsername: row.fromUsername ?? undefined,
        toUsername: row.toUsername ?? undefined,
        description: row.description ?? undefined,
        billerId: row.billerId ?? undefined,
        cardId: row.cardId ?? undefined,
    };
}

export function makeTransferRepo(db: Db): TransferRepo {
    return {
        findById(id) {
            const [row] = db.select().from(transfers).where(eq(transfers.id, id)).limit(1).all();
            return row ? toDomain(row) : undefined;
        },
        findByIdempotencyKey(key) {
            const [row] = db
                .select()
                .from(transfers)
                .where(eq(transfers.idempotencyKey, key))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        insert(t) {
            db.insert(transfers)
                .values({
                    id: t.id,
                    idempotencyKey: t.idempotencyKey ?? null,
                    fromAccountId: t.fromAccountId ?? null,
                    toAccountId: t.toAccountId ?? null,
                    amountMinor: t.amountMinor,
                    currency: t.currency,
                    memo: t.memo ?? null,
                    kind: t.kind,
                    status: t.status,
                    rail: t.rail,
                    utr: t.utr ?? null,
                    failureReason: t.failureReason ?? null,
                    postedAt: t.postedAt,
                    referenceNumber: t.referenceNumber ?? null,
                    feeMinor: t.feeMinor,
                    category: t.category ?? null,
                    fromAccountNumber: t.fromAccountNumber ?? null,
                    toAccountNumber: t.toAccountNumber ?? null,
                    fromUsername: t.fromUsername ?? null,
                    toUsername: t.toUsername ?? null,
                    description: t.description ?? null,
                    billerId: t.billerId ?? null,
                    cardId: t.cardId ?? null,
                })
                .run();
        },
        update(t) {
            db.update(transfers)
                .set({
                    status: t.status,
                    utr: t.utr ?? null,
                    failureReason: t.failureReason ?? null,
                    postedAt: t.postedAt,
                    description: t.description ?? null,
                })
                .where(eq(transfers.id, t.id))
                .run();
        },
        list(limit) {
            const rows = db
                .select()
                .from(transfers)
                .orderBy(desc(transfers.postedAt))
                .limit(limit)
                .all();
            return rows.map(toDomain);
        },
        listPendingByRail(rail) {
            const rows = db
                .select()
                .from(transfers)
                .where(and(eq(transfers.status, "pending"), eq(transfers.rail, rail)))
                .orderBy(desc(transfers.postedAt))
                .all();
            return rows.map(toDomain);
        },
        settlePending(id, patch) {
            db.update(transfers)
                .set({
                    status: patch.status,
                    utr: patch.utr ?? null,
                    postedAt: patch.postedAt,
                    failureReason: patch.failureReason ?? null,
                })
                .where(and(eq(transfers.id, id), eq(transfers.status, "pending")))
                .run();
        },
    };
}
