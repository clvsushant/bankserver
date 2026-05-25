import { eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { accounts } from "../../../db/schema";
import type { Account, AccountStatus, AccountType } from "../domain/account";
import type { Currency } from "../../../shared/money";
import type { AccountRepo } from "../application/ports";

function toDomain(row: typeof accounts.$inferSelect): Account {
    return {
        id: row.id,
        accountNumber: row.accountNumber,
        userId: row.userId,
        accountType: row.accountType as AccountType,
        status: row.status as AccountStatus,
        balanceMinor: row.balanceMinor,
        currency: row.currency as Currency,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export function makeAccountRepo(db: Db): AccountRepo {
    return {
        findById(id) {
            const [row] = db.select().from(accounts).where(eq(accounts.id, id)).limit(1).all();
            return row ? toDomain(row) : undefined;
        },
        findByAccountNumber(accountNumber) {
            const [row] = db
                .select()
                .from(accounts)
                .where(eq(accounts.accountNumber, accountNumber))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listByUserId(userId) {
            const rows = db.select().from(accounts).where(eq(accounts.userId, userId)).all();
            return rows.map(toDomain);
        },
        list(limit) {
            const rows = db.select().from(accounts).limit(limit).all();
            return rows.map(toDomain);
        },
        insert(a) {
            db.insert(accounts)
                .values({
                    id: a.id,
                    accountNumber: a.accountNumber,
                    userId: a.userId,
                    accountType: a.accountType,
                    status: a.status,
                    balanceMinor: a.balanceMinor,
                    currency: a.currency,
                    createdAt: a.createdAt,
                    updatedAt: a.updatedAt,
                })
                .run();
        },
        update(a) {
            db.update(accounts)
                .set({
                    status: a.status,
                    balanceMinor: a.balanceMinor,
                    currency: a.currency,
                    updatedAt: a.updatedAt,
                })
                .where(eq(accounts.id, a.id))
                .run();
        },
    };
}
