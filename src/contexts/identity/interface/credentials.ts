import express from "express";
import { container } from "../../../container";
import { isNonEmptyString } from "../../../utils/validate";
import {
    BadRequestError,
    ConflictError,
    HttpError,
    NotFoundError,
} from "../../../utils/errors";
import { requireStepUp } from "../../../middleware/step-up";
import { requireOtp } from "../../../middleware/otp";
import { auditMiddleware } from "../../audit/interface/middleware";
import { AuditActions } from "../../audit/domain/actions";
import { setLoginState } from "../application/loginStateMachine";

/**
 * Phase 4 #1 — passkey self-service routes. Mounted under /identity/credentials,
 * encrypted + requireSession. Hard-coded ownership check on every action.
 *
 * Responses redact the public key blob — clients never need it client-side.
 */
export const credentialsRouter = express.Router();

credentialsRouter.get("/", (req, res, next) => {
    try {
        const user = req.user!;
        const list = container.repos.credentials.listByUserId(user.id);
        res.json({
            credentials: list.map((c) => ({
                id: c.id,
                label: c.label ?? null,
                deviceType: c.deviceType,
                backedUp: c.backedUp,
                transports: c.transports ?? [],
                createdAt: c.createdAt.toISOString(),
                lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
            })),
        });
    } catch (err) {
        next(err);
    }
});

function pathId(req: express.Request): string | null {
    return typeof req.params.id === "string" ? req.params.id : null;
}

/**
 * POST /identity/credentials/enroll-options
 *
 * Settings-side counterpart to /identity/login/recovery: an already-
 * authenticated user passes step-up (`passkey.add`), and we mint an
 * `enroll-additional` login state for the current session. The client then
 * runs the regular /webauthn/registration/options + /verify ceremony with
 * that nonce and lands a new credential.
 */
credentialsRouter.post(
    "/enroll-options",
    requireOtp("passkey.add"),
    requireStepUp("passkey.add"),
    auditMiddleware(AuditActions.AuthPasskeyEnrolledAdditional, {
        target: (req) =>
            req.user ? { type: "user", id: req.user.id } : null,
    }),
    (req, res, next) => {
        try {
            const user = req.user!;
            const sessionId = req.sessionId!;
            const { nonce, expiresAt } = setLoginState(sessionId, {
                userId: user.id,
                username: user.username,
                purpose: "enroll-additional",
            });
            res.json({ nonce, expiresAt });
        } catch (err) {
            next(err);
        }
    }
);

credentialsRouter.post(
    "/:id/label",
    auditMiddleware(AuditActions.AuthPasskeyLabeled, {
        target: (req) =>
            pathId(req) ? { type: "credential", id: pathId(req)! } : null,
    }),
    (req, res, next) => {
    try {
        const user = req.user!;
        const id = pathId(req);
        if (!id) return next(new NotFoundError("Credential not found"));
        const body = (req.body || {}) as Record<string, unknown>;
        const label = body.label;
        if (typeof label !== "string" || label.length === 0 || label.length > 64)
            return next(new BadRequestError("Invalid label"));
        const cred = container.repos.credentials.findById(id);
        if (!cred || cred.userId !== user.id)
            return next(new NotFoundError("Credential not found"));
        container.repos.credentials.setLabel(id, label.trim());
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

credentialsRouter.post(
    "/:id/revoke",
    requireOtp("passkey.revoke"),
    requireStepUp("passkey.revoke"),
    auditMiddleware(AuditActions.AuthPasskeyRevoked, {
        target: (req) =>
            pathId(req) ? { type: "credential", id: pathId(req)! } : null,
    }),
    (req, res, next) => {
        try {
            const user = req.user!;
            const id = pathId(req);
            if (!isNonEmptyString(id, 256))
                return next(new BadRequestError("Invalid credential id"));
            const cred = container.repos.credentials.findById(id);
            if (!cred || cred.userId !== user.id)
                return next(new NotFoundError("Credential not found"));

            const total = container.repos.credentials.countByUserId(user.id);
            if (total <= 1)
                return next(
                    new ConflictError(
                        "Cannot revoke the last passkey. Add another before revoking."
                    )
                );
            container.repos.credentials.delete(id);
            container.bus.publish([
                {
                    type: "PasskeyRevoked",
                    userId: user.id,
                    credentialId: id,
                    revokedAt: container.clock.now(),
                } as unknown as { type: string },
            ]);
            res.json({ success: true });
        } catch (err) {
            if (err instanceof HttpError) return next(err);
            next(err);
        }
    }
);
