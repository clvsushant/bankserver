import type { Request, Response, NextFunction } from "express";
import { container } from "../../../container";
import { recordAudit } from "../application/recordAudit";
import { categoryOf, type AuditAction, type AuditCategory } from "../domain/actions";
import logger from "../../../utils/logger";
import { getContext } from "../../../utils/context-storage";

interface AuditMiddlewareOpts {
    /** Override category if it can't be derived from the action prefix. */
    category?: AuditCategory;
    /**
     * Pull a target id from the request. Returns `{ type, id }` or null.
     *
     * `id` accepts `string | string[]` so call sites can pass `req.params.id`
     * directly (Express types path params as `string | string[]`); arrays
     * are coerced to a comma-joined string.
     */
    target?: (
        req: Request
    ) => { type: string; id: string | string[] } | null | undefined;
    /** Override the default summary text. */
    summary?: string | ((req: Request, res: Response) => string);
    /**
     * Custom payload extractor. Defaults to `{ body: req.body, params:
     * req.params, query: req.query }`. Whatever is returned is run through
     * the redactor before persistence.
     */
    payload?: (req: Request, res: Response) => unknown;
}

function normaliseId(v: string | string[]): string {
    return Array.isArray(v) ? v.join(",") : v;
}

type AuditedRequest = Request & {
    user?: { id: string; username: string; role: "customer" | "admin" };
    sessionId?: string;
};

/**
 * Express middleware factory that records exactly one audit row per
 * request. Mounted *after* requireSession (and requireRole for admin
 * paths) so we have an authenticated actor to credit.
 *
 * Statuses:
 *   - 2xx → "success"
 *   - 4xx / 5xx → "failure" (with the response status code surfaced as
 *     the errorCode for filtering)
 */
export function auditMiddleware(action: AuditAction, opts: AuditMiddlewareOpts = {}) {
    const category = opts.category ?? categoryOf(action);

    return function audit(req: Request, res: Response, next: NextFunction) {
        const audited = req as AuditedRequest;

        // Snapshot inputs at entry. By the time `finish` fires, body may
        // have been emptied or replaced (encryptedResponse reads it).
        const bodySnap = audited.body && typeof audited.body === "object" ? { ...(audited.body as object) } : audited.body;
        const paramsSnap = audited.params ? { ...audited.params } : {};
        const querySnap = audited.query ? { ...audited.query } : {};
        const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip;
        const userAgent = (req.headers["user-agent"] as string | undefined) ?? undefined;
        const requestId = getContext()?.requestId;

        let recorded = false;
        const writeOnce = (statusCodeOverride?: number) => {
            if (recorded) return;
            recorded = true;

            const status = (statusCodeOverride ?? res.statusCode) >= 400 ? "failure" : "success";
            const rawTarget = opts.target?.(req);
            const target = rawTarget
                ? { type: rawTarget.type, id: normaliseId(rawTarget.id) }
                : undefined;
            const summary =
                typeof opts.summary === "function"
                    ? opts.summary(req, res)
                    : opts.summary ?? defaultSummary(action, res.statusCode);
            const payloadIn = opts.payload
                ? opts.payload(req, res)
                : { body: bodySnap, params: paramsSnap, query: querySnap };

            try {
                recordAudit(
                    {
                        repo: container.repos.audit,
                        clock: container.clock,
                        ids: container.ids,
                    },
                    {
                        action,
                        category,
                        actor: audited.user
                            ? {
                                  userId: audited.user.id,
                                  username: audited.user.username,
                                  role: audited.user.role,
                              }
                            : { role: "anonymous" },
                        sessionId: audited.sessionId,
                        target,
                        status,
                        errorCode: status === "failure" ? String(res.statusCode) : undefined,
                        summary,
                        payload: payloadIn,
                        requestId,
                        ip,
                        userAgent,
                    }
                );
            } catch (err) {
                // Audit MUST NOT take down the request. Log and swallow.
                logger.error("audit.middleware.failed", {
                    action,
                    error: (err as Error).message,
                });
            }
        };

        res.on("finish", () => writeOnce());
        res.on("close", () => writeOnce());

        next();
    };
}

function defaultSummary(action: AuditAction, statusCode: number): string {
    return statusCode >= 400 ? `${action} failed (${statusCode})` : action;
}
