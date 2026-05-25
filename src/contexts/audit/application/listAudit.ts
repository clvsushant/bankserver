import type { AuditRepo, ListAuditFilter, ListAuditPage } from "./ports";

const MAX_PAGE = 200;
const DEFAULT_LIMIT = 50;

export function listAudit(
    deps: { repo: AuditRepo },
    filter: Partial<ListAuditFilter>
): ListAuditPage {
    const limit = Math.max(1, Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_PAGE));
    const offset = Math.max(0, filter.offset ?? 0);
    return deps.repo.list({
        actorUserId: filter.actorUserId,
        actorUsername: filter.actorUsername,
        action: filter.action,
        category: filter.category,
        status: filter.status,
        targetType: filter.targetType,
        targetId: filter.targetId,
        from: filter.from,
        to: filter.to,
        limit,
        offset,
    });
}
