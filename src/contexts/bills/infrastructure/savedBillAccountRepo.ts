import { desc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { savedBillAccounts } from "../../../db/schema";
import type { SavedBillAccount } from "../domain/savedBillAccount";

export interface SavedBillAccountRepo {
    findById(id: string): SavedBillAccount | undefined;
    listByUserId(userId: string): SavedBillAccount[];
    insert(row: SavedBillAccount): void;
    delete(id: string): void;
}

function toDomain(row: typeof savedBillAccounts.$inferSelect): SavedBillAccount {
    return {
        id: row.id,
        userId: row.userId,
        billerId: row.billerId,
        customerRef: row.customerRef,
        nickname: row.nickname,
        createdAt: row.createdAt,
    };
}

export function makeSavedBillAccountRepo(db: Db): SavedBillAccountRepo {
    return {
        findById(id) {
            const [row] = db
                .select()
                .from(savedBillAccounts)
                .where(eq(savedBillAccounts.id, id))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listByUserId(userId) {
            return db
                .select()
                .from(savedBillAccounts)
                .where(eq(savedBillAccounts.userId, userId))
                .orderBy(desc(savedBillAccounts.createdAt))
                .all()
                .map(toDomain);
        },
        insert(row) {
            db.insert(savedBillAccounts)
                .values({
                    id: row.id,
                    userId: row.userId,
                    billerId: row.billerId,
                    customerRef: row.customerRef,
                    nickname: row.nickname,
                    createdAt: row.createdAt,
                })
                .run();
        },
        delete(id) {
            db.delete(savedBillAccounts).where(eq(savedBillAccounts.id, id)).run();
        },
    };
}
