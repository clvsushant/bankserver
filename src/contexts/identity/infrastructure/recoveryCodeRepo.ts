import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { recoveryCodes } from "../../../db/schema";
import type {
    RecoveryCode,
    RecoveryCodePurpose,
} from "../domain/recoveryCode";
import type { RecoveryCodeRepo } from "../application/ports";

function toDomain(row: typeof recoveryCodes.$inferSelect): RecoveryCode {
    return {
        id: row.id,
        userId: row.userId,
        codeHash: row.codeHash,
        issuedAt: row.issuedAt,
        issuedByAdminId: row.issuedByAdminId ?? undefined,
        expiresAt: row.expiresAt,
        consumedAt: row.consumedAt ?? undefined,
        purpose: row.purpose as RecoveryCodePurpose,
    };
}

export function makeRecoveryCodeRepo(db: Db): RecoveryCodeRepo {
    return {
        insert(code) {
            db.insert(recoveryCodes)
                .values({
                    id: code.id,
                    userId: code.userId,
                    codeHash: code.codeHash,
                    issuedAt: code.issuedAt,
                    issuedByAdminId: code.issuedByAdminId ?? null,
                    expiresAt: code.expiresAt,
                    consumedAt: code.consumedAt ?? null,
                    purpose: code.purpose,
                })
                .run();
        },
        listActiveByUserId(userId, now) {
            const rows = db
                .select()
                .from(recoveryCodes)
                .where(
                    and(
                        eq(recoveryCodes.userId, userId),
                        isNull(recoveryCodes.consumedAt),
                        gt(recoveryCodes.expiresAt, now)
                    )
                )
                .orderBy(desc(recoveryCodes.issuedAt))
                .all();
            return rows.map(toDomain);
        },
        findById(id) {
            const [row] = db
                .select()
                .from(recoveryCodes)
                .where(eq(recoveryCodes.id, id))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        markConsumed(id, at) {
            db.update(recoveryCodes)
                .set({ consumedAt: at })
                .where(eq(recoveryCodes.id, id))
                .run();
        },
    };
}
