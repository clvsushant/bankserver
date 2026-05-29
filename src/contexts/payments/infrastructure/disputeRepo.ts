import { desc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { disputes } from "../../../db/schema";
import type { Dispute, DisputeStatus } from "../domain/dispute";
import type { DisputeRepo } from "../application/ports";

function toDomain(row: typeof disputes.$inferSelect): Dispute {
    return {
        id: row.id,
        userId: row.userId,
        transferId: row.transferId,
        reason: row.reason,
        status: row.status as DisputeStatus,
        adminNote: row.adminNote ?? undefined,
        reversalTransferId: row.reversalTransferId ?? undefined,
        createdAt: row.createdAt,
        decidedAt: row.decidedAt ?? undefined,
        decidedByUserId: row.decidedByUserId ?? undefined,
    };
}

export function makeDisputeRepo(db: Db): DisputeRepo {
    return {
        findById(id) {
            const [row] = db.select().from(disputes).where(eq(disputes.id, id)).limit(1).all();
            return row ? toDomain(row) : undefined;
        },
        listByUserId(userId) {
            const rows = db
                .select()
                .from(disputes)
                .where(eq(disputes.userId, userId))
                .orderBy(desc(disputes.createdAt))
                .all();
            return rows.map(toDomain);
        },
        listAll(limit) {
            const rows = db
                .select()
                .from(disputes)
                .orderBy(desc(disputes.createdAt))
                .limit(limit)
                .all();
            return rows.map(toDomain);
        },
        insert(d) {
            db.insert(disputes)
                .values({
                    id: d.id,
                    userId: d.userId,
                    transferId: d.transferId,
                    reason: d.reason,
                    status: d.status,
                    adminNote: d.adminNote ?? null,
                    reversalTransferId: d.reversalTransferId ?? null,
                    createdAt: d.createdAt,
                    decidedAt: d.decidedAt ?? null,
                    decidedByUserId: d.decidedByUserId ?? null,
                })
                .run();
        },
        update(d) {
            db.update(disputes)
                .set({
                    status: d.status,
                    adminNote: d.adminNote ?? null,
                    reversalTransferId: d.reversalTransferId ?? null,
                    decidedAt: d.decidedAt ?? null,
                    decidedByUserId: d.decidedByUserId ?? null,
                })
                .where(eq(disputes.id, d.id))
                .run();
        },
    };
}
