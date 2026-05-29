import { eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { nominees } from "../../../db/schema";
import type { Nominee } from "../domain/nominee";
import type { NomineeRepo } from "../application/ports";

function toDomain(row: typeof nominees.$inferSelect): Nominee {
    return {
        id: row.id,
        accountId: row.accountId,
        userId: row.userId,
        fullName: row.fullName,
        relation: row.relation,
        sharePercent: row.sharePercent,
        createdAt: row.createdAt,
    };
}

export function makeNomineeRepo(db: Db): NomineeRepo {
    return {
        findById(id) {
            const [row] = db.select().from(nominees).where(eq(nominees.id, id)).limit(1).all();
            return row ? toDomain(row) : undefined;
        },
        listByAccountId(accountId) {
            const rows = db.select().from(nominees).where(eq(nominees.accountId, accountId)).all();
            return rows.map(toDomain);
        },
        insert(n) {
            db.insert(nominees)
                .values({
                    id: n.id,
                    accountId: n.accountId,
                    userId: n.userId,
                    fullName: n.fullName,
                    relation: n.relation,
                    sharePercent: n.sharePercent,
                    createdAt: n.createdAt,
                })
                .run();
        },
        delete(id) {
            db.delete(nominees).where(eq(nominees.id, id)).run();
        },
    };
}
