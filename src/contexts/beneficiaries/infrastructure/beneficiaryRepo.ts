import { and, desc, eq, lte } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { beneficiaries } from "../../../db/schema";
import {
    activateBeneficiary,
    type Beneficiary,
    type BeneficiaryStatus,
} from "../domain/beneficiary";
import type { BeneficiaryRepo } from "../application/ports";

function toDomain(row: typeof beneficiaries.$inferSelect): Beneficiary {
    return {
        id: row.id,
        ownerUserId: row.ownerUserId,
        nickname: row.nickname,
        accountNumber: row.accountNumber,
        beneficiaryUsername: row.beneficiaryUsername ?? undefined,
        status: (row.status as BeneficiaryStatus) ?? "pending",
        activatedAt: row.activatedAt ?? undefined,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt ?? undefined,
    };
}

function maybeActivate(b: Beneficiary, now: Date): Beneficiary {
    if (b.status === "active") return b;
    if (b.activatedAt && now.getTime() >= b.activatedAt.getTime()) {
        return activateBeneficiary(b, now);
    }
    return b;
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
            const now = new Date();
            return rows.map((row) => {
                const b = toDomain(row);
                const activated = maybeActivate(b, now);
                if (activated.status !== b.status) {
                    db.update(beneficiaries)
                        .set({ status: "active" })
                        .where(eq(beneficiaries.id, row.id))
                        .run();
                }
                return activated;
            });
        },
        insert(b) {
            db.insert(beneficiaries)
                .values({
                    id: b.id,
                    ownerUserId: b.ownerUserId,
                    nickname: b.nickname,
                    accountNumber: b.accountNumber,
                    beneficiaryUsername: b.beneficiaryUsername ?? null,
                    status: b.status,
                    activatedAt: b.activatedAt ?? null,
                    verifiedAt: null,
                    createdAt: b.createdAt,
                    lastUsedAt: b.lastUsedAt ?? null,
                })
                .run();
        },
        update(b) {
            db.update(beneficiaries)
                .set({
                    nickname: b.nickname,
                    status: b.status,
                    activatedAt: b.activatedAt ?? null,
                    lastUsedAt: b.lastUsedAt ?? null,
                })
                .where(eq(beneficiaries.id, b.id))
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
        activateDueBeneficiaries(now) {
            const rows = db
                .select()
                .from(beneficiaries)
                .where(
                    and(
                        eq(beneficiaries.status, "pending"),
                        lte(beneficiaries.activatedAt, now)
                    )
                )
                .all();
            for (const row of rows) {
                db.update(beneficiaries)
                    .set({ status: "active" })
                    .where(eq(beneficiaries.id, row.id))
                    .run();
            }
            return rows.length;
        },
    };
}
