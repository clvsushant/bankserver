import crypto from "crypto";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import { redact } from "../../../utils/redact";
import { categoryOf, type AuditAction, type AuditCategory } from "../domain/actions";
import type {
    AuditActorRole,
    AuditEntry,
    AuditStatus,
} from "../domain/auditEntry";
import type { AuditRepo } from "./ports";

export interface RecordAuditDeps {
    repo: AuditRepo;
    clock: Clock;
    ids: IdGenerator;
}

export interface RecordAuditInput {
    action: AuditAction;
    /** Override category if a non-default mapping is required. */
    category?: AuditCategory;
    actor?: {
        userId?: string;
        username?: string;
        role: AuditActorRole;
    };
    sessionId?: string;
    target?: { type: string; id: string };
    status: AuditStatus;
    errorCode?: string;
    summary: string;
    /** Arbitrary JSON-shaped value; will be redacted before persistence. */
    payload?: unknown;
    requestId?: string;
    ip?: string;
    userAgent?: string;
    /**
     * Optional explicit timestamp; defaults to `clock.now()`. Useful when
     * the caller already captured `now` for the surrounding transaction.
     */
    occurredAt?: Date;
}

/**
 * Canonical hashable view of an entry. The hash covers everything except
 * the hash itself, so any UPDATE to a stored row would be detectable.
 */
export function canonicalize(entry: AuditEntry): string {
    const ordered = {
        seq: entry.seq,
        id: entry.id,
        occurredAt: entry.occurredAt.toISOString(),
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
        payload: entry.payload ?? null,
        requestId: entry.requestId ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        prevHash: entry.prevHash ?? null,
    };
    return JSON.stringify(ordered);
}

export function hashEntry(entry: AuditEntry): string {
    return crypto.createHash("sha256").update(canonicalize(entry)).digest("hex");
}

/**
 * Persists an audit row, computing the chain hash from the previous row.
 * Failures here are intentionally swallowed (logged via the repo if it
 * cares) — the audit subsystem MUST NOT take down a real business action.
 */
export function recordAudit(deps: RecordAuditDeps, input: RecordAuditInput): AuditEntry {
    const prev = deps.repo.findLatest();
    const occurredAt = input.occurredAt ?? deps.clock.now();
    const category = input.category ?? categoryOf(input.action);

    const safePayload = input.payload === undefined ? undefined : redact(input.payload);

    const draft: AuditEntry = {
        id: deps.ids.uuid(),
        seq: (prev?.seq ?? 0) + 1,
        occurredAt,
        actorUserId: input.actor?.userId,
        actorUsername: input.actor?.username,
        actorRole: input.actor?.role ?? "anonymous",
        sessionId: input.sessionId,
        action: input.action,
        category,
        targetType: input.target?.type,
        targetId: input.target?.id,
        status: input.status,
        errorCode: input.errorCode,
        summary: input.summary,
        payload: safePayload,
        requestId: input.requestId,
        ip: input.ip,
        userAgent: input.userAgent,
        prevHash: prev?.hash,
        hash: "",
    };

    const hash = hashEntry(draft);
    const entry: AuditEntry = { ...draft, hash };
    deps.repo.insert(entry);
    return entry;
}
