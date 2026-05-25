import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { kycApplications } from "../../../db/schema";
import type { KycApplication, KycStatus } from "../domain/kycApplication";
import type { AccountType } from "../../accounts/domain/account";
import type { KycRepo } from "../application/ports";

function toDomain(row: typeof kycApplications.$inferSelect): KycApplication {
    return {
        id: row.id,
        userId: row.userId,
        fullName: row.fullName,
        dob: row.dob,
        pan: row.pan,
        address: row.address,
        docB64: row.docB64 ?? undefined,
        requestedAccountType: row.requestedAccountType as AccountType,
        status: row.status as KycStatus,
        submittedAt: row.submittedAt,
        decidedAt: row.decidedAt ?? undefined,
        decidedByUserId: row.decidedByUserId ?? undefined,
        rejectReason: row.rejectReason ?? undefined,
    };
}

export function makeKycRepo(db: Db): KycRepo {
    return {
        findById(id) {
            const [row] = db
                .select()
                .from(kycApplications)
                .where(eq(kycApplications.id, id))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        findActiveByUserId(userId) {
            const [row] = db
                .select()
                .from(kycApplications)
                .where(
                    and(
                        eq(kycApplications.userId, userId),
                        inArray(kycApplications.status, ["Submitted", "Approved"])
                    )
                )
                .orderBy(desc(kycApplications.submittedAt))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        listByUserId(userId) {
            const rows = db
                .select()
                .from(kycApplications)
                .where(eq(kycApplications.userId, userId))
                .orderBy(desc(kycApplications.submittedAt))
                .all();
            return rows.map(toDomain);
        },
        listByStatus(status, limit) {
            const rows = db
                .select()
                .from(kycApplications)
                .where(eq(kycApplications.status, status))
                .orderBy(desc(kycApplications.submittedAt))
                .limit(limit)
                .all();
            return rows.map(toDomain);
        },
        insert(app) {
            db.insert(kycApplications)
                .values({
                    id: app.id,
                    userId: app.userId,
                    fullName: app.fullName,
                    dob: app.dob,
                    pan: app.pan,
                    address: app.address,
                    docB64: app.docB64 ?? null,
                    requestedAccountType: app.requestedAccountType,
                    status: app.status,
                    submittedAt: app.submittedAt,
                    decidedAt: app.decidedAt ?? null,
                    decidedByUserId: app.decidedByUserId ?? null,
                    rejectReason: app.rejectReason ?? null,
                })
                .run();
        },
        update(app) {
            db.update(kycApplications)
                .set({
                    status: app.status,
                    decidedAt: app.decidedAt ?? null,
                    decidedByUserId: app.decidedByUserId ?? null,
                    rejectReason: app.rejectReason ?? null,
                })
                .where(eq(kycApplications.id, app.id))
                .run();
        },
    };
}
