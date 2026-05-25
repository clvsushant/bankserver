import { and, asc, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { auditLog } from "../../../db/schema";
import type { AuditEntry, AuditActorRole, AuditStatus } from "../domain/auditEntry";
import type { AuditAction, AuditCategory } from "../domain/actions";
import type { AuditRepo, ListAuditFilter, ListAuditPage } from "../application/ports";

function toDomain(row: typeof auditLog.$inferSelect): AuditEntry {
    let payload: unknown = undefined;
    if (row.payload) {
        try {
            payload = JSON.parse(row.payload);
        } catch {
            payload = row.payload;
        }
    }
    return {
        id: row.id,
        seq: row.seq,
        occurredAt: row.occurredAt,
        actorUserId: row.actorUserId ?? undefined,
        actorUsername: row.actorUsername ?? undefined,
        actorRole: row.actorRole as AuditActorRole,
        sessionId: row.sessionId ?? undefined,
        action: row.action as AuditAction,
        category: row.category as AuditCategory,
        targetType: row.targetType ?? undefined,
        targetId: row.targetId ?? undefined,
        status: row.status as AuditStatus,
        errorCode: row.errorCode ?? undefined,
        summary: row.summary,
        payload,
        requestId: row.requestId ?? undefined,
        ip: row.ip ?? undefined,
        userAgent: row.userAgent ?? undefined,
        prevHash: row.prevHash ?? undefined,
        hash: row.hash,
    };
}

export function makeAuditRepo(db: Db): AuditRepo {
    return {
        insert(entry) {
            db.insert(auditLog)
                .values({
                    id: entry.id,
                    seq: entry.seq,
                    occurredAt: entry.occurredAt,
                    actorUserId: entry.actorUserId ?? null,
                    actorUsername: entry.actorUsername ?? null,
                    actorRole: entry.actorRole,
                    sessionId: entry.sessionId ?? null,
                    action: entry.action,
                    category: entry.category,
                    targetType: entry.targetType ?? null,
                    targetId: entry.targetId ?? null,
                    status: entry.status,
                    errorCode: entry.errorCode ?? null,
                    summary: entry.summary,
                    payload:
                        entry.payload === undefined
                            ? null
                            : JSON.stringify(entry.payload),
                    requestId: entry.requestId ?? null,
                    ip: entry.ip ?? null,
                    userAgent: entry.userAgent ?? null,
                    prevHash: entry.prevHash ?? null,
                    hash: entry.hash,
                })
                .run();
        },
        findById(id) {
            const [row] = db
                .select()
                .from(auditLog)
                .where(eq(auditLog.id, id))
                .limit(1)
                .all();
            return row ? toDomain(row) : undefined;
        },
        list(filter): ListAuditPage {
            const conds = buildWhere(filter);
            const where = conds.length > 0 ? and(...conds) : undefined;

            const rowsQuery = db.select().from(auditLog);
            const filtered = where ? rowsQuery.where(where) : rowsQuery;
            const rows = filtered
                .orderBy(desc(auditLog.seq))
                .limit(filter.limit + 1)
                .offset(filter.offset)
                .all();

            const hasMore = rows.length > filter.limit;
            const page = (hasMore ? rows.slice(0, filter.limit) : rows).map(toDomain);

            const countQuery = db
                .select({ n: sql<number>`count(*)` })
                .from(auditLog);
            const [{ n: total = 0 } = { n: 0 }] = (where
                ? countQuery.where(where)
                : countQuery
            ).all();

            return { entries: page, total: Number(total), hasMore };
        },
        listAllChronological() {
            const rows = db
                .select()
                .from(auditLog)
                .orderBy(asc(auditLog.seq))
                .all();
            return rows.map(toDomain);
        },
        findLatest() {
            const [row] = db
                .select({ hash: auditLog.hash, seq: auditLog.seq })
                .from(auditLog)
                .orderBy(desc(auditLog.seq))
                .limit(1)
                .all();
            return row ? { hash: row.hash, seq: row.seq } : undefined;
        },
    };
}

function buildWhere(f: ListAuditFilter) {
    const conds = [];
    if (f.actorUserId) conds.push(eq(auditLog.actorUserId, f.actorUserId));
    if (f.actorUsername) conds.push(like(auditLog.actorUsername, `%${f.actorUsername}%`));
    if (f.action) conds.push(eq(auditLog.action, f.action));
    if (f.category) conds.push(eq(auditLog.category, f.category));
    if (f.status) conds.push(eq(auditLog.status, f.status));
    if (f.targetType) conds.push(eq(auditLog.targetType, f.targetType));
    if (f.targetId) conds.push(eq(auditLog.targetId, f.targetId));
    if (f.from) conds.push(gte(auditLog.occurredAt, f.from));
    if (f.to) conds.push(lte(auditLog.occurredAt, f.to));
    return conds;
}
