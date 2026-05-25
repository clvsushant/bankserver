import type { AuditAction, AuditCategory } from "./actions";

export type AuditStatus = "success" | "failure";
export type AuditActorRole = "customer" | "admin" | "system" | "anonymous";

/**
 * Persisted shape. Append-only — never UPDATE/DELETE existing rows.
 *
 * `prevHash` + `hash` form a chain so the integrity-verify endpoint can
 * detect tampering. `seq` is a monotonic ordering used to walk the chain
 * deterministically when many entries share the same `occurredAt` ms.
 */
export interface AuditEntry {
    readonly id: string;
    readonly seq: number;
    readonly occurredAt: Date;
    readonly actorUserId?: string;
    readonly actorUsername?: string;
    readonly actorRole: AuditActorRole;
    readonly sessionId?: string;
    readonly action: AuditAction;
    readonly category: AuditCategory;
    readonly targetType?: string;
    readonly targetId?: string;
    readonly status: AuditStatus;
    readonly errorCode?: string;
    readonly summary: string;
    readonly payload?: unknown;
    readonly requestId?: string;
    readonly ip?: string;
    readonly userAgent?: string;
    readonly prevHash?: string;
    readonly hash: string;
}
