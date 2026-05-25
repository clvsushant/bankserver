import type { AuditEntry } from "../domain/auditEntry";
import type { AuditAction, AuditCategory } from "../domain/actions";

export interface ListAuditFilter {
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
}

export interface ListAuditPage {
    entries: AuditEntry[];
    total: number;
    hasMore: boolean;
}

export interface AuditRepo {
    insert(entry: AuditEntry): void;
    findById(id: string): AuditEntry | undefined;
    list(filter: ListAuditFilter): ListAuditPage;
    /** All entries in chronological order (used by /admin/audit/verify). */
    listAllChronological(): AuditEntry[];
    /** Last persisted hash, or undefined for an empty table. */
    findLatest(): { hash: string; seq: number } | undefined;
}
