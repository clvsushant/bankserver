import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { externalBeneficiaries } from "../../../db/schema";
import type {
    ExternalBeneficiary,
    ExternalBeneficiaryStatus,
    PreferredRail,
} from "../domain/externalBeneficiary";
import type { ExternalBeneficiaryRepo } from "../application/ports";

function toDomain(row: typeof externalBeneficiaries.$inferSelect): ExternalBeneficiary {
    return {
        id: row.id,
        ownerUserId: row.ownerUserId,
        nickname: row.nickname,
        accountNumber: row.accountNumber,
        ifsc: row.ifsc,
        bankName: row.bankName,
        beneficiaryName: row.beneficiaryName,
        vpa: row.vpa ?? undefined,
        preferredRail: (row.preferredRail as PreferredRail | null) ?? undefined,
        status: row.status as ExternalBeneficiaryStatus,
        activatedAt: row.activatedAt ?? undefined,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt ?? undefined,
    };
}

export function makeExternalBeneficiaryRepo(db: Db): ExternalBeneficiaryRepo {
    return {
        findById(id) {
            const [row] = db
                .select()
                .from(externalBeneficiaries)
                .where(eq(externalBeneficiaries.id, id))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listByOwner(ownerUserId) {
            const rows = db
                .select()
                .from(externalBeneficiaries)
                .where(eq(externalBeneficiaries.ownerUserId, ownerUserId))
                .orderBy(desc(externalBeneficiaries.createdAt))
                .all();
            return rows.map(toDomain);
        },
        insert(b) {
            db.insert(externalBeneficiaries)
                .values({
                    id: b.id,
                    ownerUserId: b.ownerUserId,
                    nickname: b.nickname,
                    accountNumber: b.accountNumber,
                    ifsc: b.ifsc,
                    bankName: b.bankName,
                    beneficiaryName: b.beneficiaryName,
                    vpa: b.vpa ?? null,
                    preferredRail: b.preferredRail ?? null,
                    status: b.status,
                    activatedAt: b.activatedAt ?? null,
                    verifiedAt: null,
                    createdAt: b.createdAt,
                    lastUsedAt: b.lastUsedAt ?? null,
                })
                .run();
        },
        findByOwnerAccountIfsc(ownerUserId, accountNumber, ifsc) {
            const [row] = db
                .select()
                .from(externalBeneficiaries)
                .where(
                    and(
                        eq(externalBeneficiaries.ownerUserId, ownerUserId),
                        eq(externalBeneficiaries.accountNumber, accountNumber),
                        eq(externalBeneficiaries.ifsc, ifsc)
                    )
                )
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
    };
}
