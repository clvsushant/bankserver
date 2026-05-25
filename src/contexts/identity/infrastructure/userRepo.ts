import { eq, sql } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { users } from "../../../db/schema";
import type { AccountStatus, Role, User } from "../domain/user";
import type { UserRepo } from "../application/ports";

function toDomain(row: typeof users.$inferSelect): User {
    return {
        id: row.id,
        username: row.username,
        email: row.email,
        passwordHash: row.passwordHash,
        role: row.role as Role,
        accountStatus: row.accountStatus as AccountStatus,
        failedAttempts: row.failedAttempts,
        lockedUntil: row.lockedUntil ?? undefined,
        passkeyEnrolled: row.passkeyEnrolled,
        createdAt: row.createdAt,
    };
}

export function makeUserRepo(db: Db): UserRepo {
    return {
        findById(id) {
            const [row] = db.select().from(users).where(eq(users.id, id)).limit(1).all();
            return row ? toDomain(row) : undefined;
        },
        findByUsername(username) {
            const [row] = db
                .select()
                .from(users)
                .where(eq(users.username, username))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listAll() {
            return db.select().from(users).all().map(toDomain);
        },
        insert(user) {
            db.insert(users)
                .values({
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    passwordHash: user.passwordHash,
                    role: user.role,
                    accountStatus: user.accountStatus,
                    failedAttempts: user.failedAttempts,
                    lockedUntil: user.lockedUntil,
                    passkeyEnrolled: user.passkeyEnrolled,
                    createdAt: user.createdAt,
                })
                .run();
        },
        setRole(id, role) {
            db.update(users).set({ role }).where(eq(users.id, id)).run();
        },
        setAccountStatus(id, status: AccountStatus) {
            // Clearing the status also clears any temporary lockout window
            // and the failed-attempt counter so the user can retry.
            if (status === "Active") {
                db.update(users)
                    .set({ accountStatus: "Active", failedAttempts: 0, lockedUntil: null })
                    .where(eq(users.id, id))
                    .run();
            } else {
                db.update(users)
                    .set({ accountStatus: status })
                    .where(eq(users.id, id))
                    .run();
            }
        },
        setPassword(id, passwordHash) {
            db.update(users)
                .set({ passwordHash, failedAttempts: 0, lockedUntil: null })
                .where(eq(users.id, id))
                .run();
        },
        markPasskeyEnrolled(id) {
            db.update(users).set({ passkeyEnrolled: true }).where(eq(users.id, id)).run();
        },
        recordFailedAttempt(id, lockedUntil) {
            db.update(users)
                .set({
                    failedAttempts: sql`${users.failedAttempts} + 1`,
                    lockedUntil: lockedUntil ?? null,
                })
                .where(eq(users.id, id))
                .run();
        },
        resetFailedAttempts(id) {
            db.update(users)
                .set({ failedAttempts: 0, lockedUntil: null })
                .where(eq(users.id, id))
                .run();
        },
    };
}
