import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { beneficiaries } from "../../../db/schema";
import type { Beneficiary } from "../domain/beneficiary";
import type { BeneficiaryRepo } from "../application/ports";

function toDomain(row: typeof beneficiaries.$inferSelect): Beneficiary {
    return {
        id: row.id,
        ownerUserId: row.ownerUserId,
        nickname: row.nickname,
        accountNumber: row.accountNumber,
        beneficiaryUsername: row.beneficiaryUsername ?? undefined,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt ?? undefined,
    };
}

export function makeBeneficiaryRepo(db: Db): BeneficiaryRepo {
    return {
        findById(id) {
            const [row] = db
                .select()
                .from(beneficiaries)
                .where(eq(beneficiaries.id, id))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        findByOwnerAndAccount(ownerUserId, accountNumber) {
            const [row] = db
                .select()
                .from(beneficiaries)
                .where(
                    and(
                        eq(beneficiaries.ownerUserId, ownerUserId),
                        eq(beneficiaries.accountNumber, accountNumber)
                    )
                )
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listByOwner(ownerUserId) {
            const rows = db
                .select()
                .from(beneficiaries)
                .where(eq(beneficiaries.ownerUserId, ownerUserId))
                .orderBy(desc(beneficiaries.lastUsedAt), desc(beneficiaries.createdAt))
                .all();
            return rows.map(toDomain);
        },
        insert(b) {
            db.insert(beneficiaries)
                .values({
                    id: b.id,
                    ownerUserId: b.ownerUserId,
                    nickname: b.nickname,
                    accountNumber: b.accountNumber,
                    beneficiaryUsername: b.beneficiaryUsername ?? null,
                    createdAt: b.createdAt,
                    lastUsedAt: b.lastUsedAt ?? null,
                })
                .run();
        },
        delete(id) {
            db.delete(beneficiaries).where(eq(beneficiaries.id, id)).run();
        },
        touch(id, at) {
            db.update(beneficiaries)
                .set({ lastUsedAt: at })
                .where(eq(beneficiaries.id, id))
                .run();
        },
    };
}
