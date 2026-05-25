import type { Request } from "express";
import { container } from "../../../container";
import { recordAudit, type RecordAuditInput } from "../application/recordAudit";
import { getContext } from "../../../utils/context-storage";

/**
 * Convenience wrapper used by route handlers that need to record an
 * audit row outside the auditMiddleware path (e.g. auth events where the
 * actor isn't on `req.user` yet, or where status depends on logic the
 * handler has but the middleware can't see).
 *
 * Auto-fills `requestId`, `ip`, `userAgent`, and `sessionId` from the
 * request. The caller still owns `action`, `status`, `summary`, and any
 * actor/target/payload overrides.
 */
export function auditFromRequest(
    req: Request,
    input: Omit<RecordAuditInput, "requestId" | "ip" | "userAgent" | "sessionId"> & {
        sessionId?: string;
    }
) {
    const sessionId = input.sessionId ?? (req as Request & { sessionId?: string }).sessionId;
    const ip =
        (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip;
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? undefined;
    const requestId = getContext()?.requestId;
    return recordAudit(
        {
            repo: container.repos.audit,
            clock: container.clock,
            ids: container.ids,
        },
        {
            ...input,
            sessionId,
            ip,
            userAgent,
            requestId,
        }
    );
}
