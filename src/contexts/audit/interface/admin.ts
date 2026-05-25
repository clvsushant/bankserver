import express from "express";
import { container } from "../../../container";
import { listAudit } from "../application/listAudit";
import { hashEntry } from "../application/recordAudit";
import { auditMiddleware } from "./middleware";
import { AuditActions, AUDIT_ACTION_VALUES, type AuditAction, type AuditCategory } from "../domain/actions";
import { BadRequestError, NotFoundError } from "../../../utils/errors";
import type { AuditEntry } from "../domain/auditEntry";

const CATEGORY_VALUES: AuditCategory[] = [
    "auth",
    "money",
    "kyc",
    "account",
    "beneficiary",
    "bill",
    "si",
    "card",
    "admin.read",
    "admin.write",
    "system",
];

const router = express.Router();

router.get("/", auditMiddleware(AuditActions.AdminAuditListed), (req, res, next) => {
    try {
        const filter = parseFilter(req.query);
        const page = listAudit({ repo: container.repos.audit }, filter);
        res.json({
            entries: page.entries.map(serialize),
            total: page.total,
            hasMore: page.hasMore,
            limit: filter.limit ?? 50,
            offset: filter.offset ?? 0,
        });
    } catch (err) {
        next(err);
    }
});

router.get("/verify", auditMiddleware(AuditActions.AdminAuditVerified), (_req, res, next) => {
    try {
        const all = container.repos.audit.listAllChronological();
        let prevHash: string | undefined = undefined;
        for (const entry of all) {
            if ((entry.prevHash ?? undefined) !== prevHash) {
                return res.json({
                    ok: false,
                    brokenAtId: entry.id,
                    brokenAtSeq: entry.seq,
                    reason: "prev_hash mismatch",
                });
            }
            const expected = hashEntry({ ...entry, hash: "" });
            if (expected !== entry.hash) {
                return res.json({
                    ok: false,
                    brokenAtId: entry.id,
                    brokenAtSeq: entry.seq,
                    reason: "hash mismatch",
                });
            }
            prevHash = entry.hash;
        }
        res.json({ ok: true, count: all.length });
    } catch (err) {
        next(err);
    }
});

router.get("/actions", (_req, res, next) => {
    try {
        res.json({ actions: AUDIT_ACTION_VALUES, categories: CATEGORY_VALUES });
    } catch (err) {
        next(err);
    }
});

router.get(
    "/export.csv",
    auditMiddleware(AuditActions.AdminAuditExported),
    (req, res, next) => {
        try {
            const filter = parseFilter(req.query);
            // Cap CSV exports at a sane upper bound; clients can refine the
            // filter to grab less.
            const csvFilter = { ...filter, limit: 5000, offset: 0 };
            const page = listAudit({ repo: container.repos.audit }, csvFilter);
            const csv = toCsv(page.entries);
            res.json({ csv, count: page.entries.length });
        } catch (err) {
            next(err);
        }
    }
);

router.get("/:id", auditMiddleware(AuditActions.AdminAuditViewed), (req, res, next) => {
    try {
        const id = req.params.id;
        if (typeof id !== "string") return next(new NotFoundError("Audit entry not found"));
        const entry = container.repos.audit.findById(id);
        if (!entry) return next(new NotFoundError("Audit entry not found"));
        res.json({ entry: serialize(entry) });
    } catch (err) {
        next(err);
    }
});

function parseFilter(q: unknown): {
    actorUserId?: string;
    actorUsername?: string;
    action?: AuditAction;
    category?: AuditCategory;
    status?: "success" | "failure";
    targetType?: string;
    targetId?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
} {
    const o = (q ?? {}) as Record<string, unknown>;
    const actorUserId = optString(o.actor) ?? optString(o.actorUserId);
    const actorUsername = optString(o.actorUsername);
    const actionRaw = optString(o.action);
    if (actionRaw && !AUDIT_ACTION_VALUES.includes(actionRaw as AuditAction))
        throw new BadRequestError(`Unknown action: ${actionRaw}`);
    const categoryRaw = optString(o.category);
    if (categoryRaw && !CATEGORY_VALUES.includes(categoryRaw as AuditCategory))
        throw new BadRequestError(`Unknown category: ${categoryRaw}`);
    const statusRaw = optString(o.status);
    if (statusRaw && statusRaw !== "success" && statusRaw !== "failure")
        throw new BadRequestError(`Unknown status: ${statusRaw}`);

    const limit = parseInt(optString(o.limit) ?? "50", 10);
    const offset = parseInt(optString(o.offset) ?? "0", 10);

    return {
        actorUserId,
        actorUsername,
        action: actionRaw as AuditAction | undefined,
        category: categoryRaw as AuditCategory | undefined,
        status: statusRaw as "success" | "failure" | undefined,
        targetType: optString(o.targetType),
        targetId: optString(o.targetId),
        from: optDate(o.from),
        to: optDate(o.to),
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
    };
}

function optString(v: unknown): string | undefined {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    return undefined;
}

function optDate(v: unknown): Date | undefined {
    const s = optString(v);
    if (!s) return undefined;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return undefined;
    return d;
}

function serialize(e: AuditEntry) {
    return {
        id: e.id,
        seq: e.seq,
        occurredAt: e.occurredAt.toISOString(),
        actorUserId: e.actorUserId ?? null,
        actorUsername: e.actorUsername ?? null,
        actorRole: e.actorRole,
        sessionId: e.sessionId ?? null,
        action: e.action,
        category: e.category,
        targetType: e.targetType ?? null,
        targetId: e.targetId ?? null,
        status: e.status,
        errorCode: e.errorCode ?? null,
        summary: e.summary,
        payload: e.payload ?? null,
        requestId: e.requestId ?? null,
        ip: e.ip ?? null,
        userAgent: e.userAgent ?? null,
        prevHash: e.prevHash ?? null,
        hash: e.hash,
    };
}

const CSV_COLUMNS = [
    "seq",
    "occurredAt",
    "actorUserId",
    "actorUsername",
    "actorRole",
    "action",
    "category",
    "targetType",
    "targetId",
    "status",
    "errorCode",
    "summary",
    "requestId",
    "ip",
    "hash",
] as const;

function toCsv(entries: AuditEntry[]): string {
    const header = CSV_COLUMNS.join(",");
    const rows = entries.map((e) =>
        CSV_COLUMNS.map((col) => csvCell(extractCol(e, col))).join(",")
    );
    return [header, ...rows].join("\n");
}

function extractCol(e: AuditEntry, col: (typeof CSV_COLUMNS)[number]): unknown {
    switch (col) {
        case "occurredAt":
            return e.occurredAt.toISOString();
        case "seq":
            return e.seq;
        default:
            return (e as unknown as Record<string, unknown>)[col] ?? "";
    }
}

function csvCell(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export default router;
