import { asc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { billers } from "../../../db/schema";
import type { Biller, BillerCategory } from "../domain/biller";
import type { BillerRepo } from "../application/ports";

function toDomain(row: typeof billers.$inferSelect): Biller {
    return {
        id: row.id,
        name: row.name,
        category: row.category as BillerCategory,
        billerAccountNumber: row.billerAccountNumber,
        active: row.active,
        createdAt: row.createdAt,
    };
}

export function makeBillerRepo(db: Db): BillerRepo {
    return {
        findById(id) {
            const [row] = db.select().from(billers).where(eq(billers.id, id)).limit(1).all();
            return row ? toDomain(row) : undefined;
        },
        findByAccountNumber(accountNumber) {
            const [row] = db
                .select()
                .from(billers)
                .where(eq(billers.billerAccountNumber, accountNumber))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listActive() {
            const rows = db
                .select()
                .from(billers)
                .where(eq(billers.active, true))
                .orderBy(asc(billers.name))
                .all();
            return rows.map(toDomain);
        },
        listAll() {
            return db.select().from(billers).orderBy(asc(billers.name)).all().map(toDomain);
        },
        insert(b) {
            db.insert(billers)
                .values({
                    id: b.id,
                    name: b.name,
                    category: b.category,
                    billerAccountNumber: b.billerAccountNumber,
                    active: b.active,
                    createdAt: b.createdAt,
                })
                .run();
        },
        setActive(id, active) {
            db.update(billers).set({ active }).where(eq(billers.id, id)).run();
        },
    };
}
