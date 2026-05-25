import express from "express";
import { container } from "../../../container";
import { isNonEmptyString } from "../../../utils/validate";
import { BadRequestError, NotFoundError } from "../../../utils/errors";
import { auditMiddleware } from "../../audit/interface/middleware";
import { AuditActions } from "../../audit/domain/actions";
import { requireOtp } from "../../../middleware/otp";
import { issueRecoveryCode } from "../application/recoveryCodes";

/**
 * Admin user-management endpoints. Mounted under /admin/users.
 *
 *   GET  /admin/users              — list all users (no passwordHash)
 *   POST /admin/users/:id/unlock   — clear lockout / set Active
 *   POST /admin/users/:id/lock     — admin-lock (no auto-expiry)
 *   POST /admin/users/:id/role     — promote / demote (customer | admin)
 */

const router = express.Router();

router.get("/", auditMiddleware(AuditActions.AdminUsersListed), (_req, res) => {
    const users = container.repos.users.listAll().map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        accountStatus: u.accountStatus,
        passkeyEnrolled: u.passkeyEnrolled,
        failedAttempts: u.failedAttempts,
        lockedUntil: u.lockedUntil ? u.lockedUntil.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
    }));
    res.json({ users });
});

function pathId(req: express.Request): string | null {
    return typeof req.params.id === "string" ? req.params.id : null;
}

router.post(
    "/:id/unlock",
    auditMiddleware(AuditActions.AdminUserUnlocked, {
        target: (req) => (pathId(req) ? { type: "user", id: pathId(req)! } : null),
    }),
    (req, res, next) => {
        try {
            const id = pathId(req);
            if (!id) return next(new NotFoundError("Unknown user"));
            const user = container.repos.users.findById(id);
            if (!user) return next(new NotFoundError("Unknown user"));
            container.repos.users.setAccountStatus(user.id, "Active");
            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    }
);

router.post(
    "/:id/lock",
    auditMiddleware(AuditActions.AdminUserLocked, {
        target: (req) => (pathId(req) ? { type: "user", id: pathId(req)! } : null),
    }),
    (req, res, next) => {
        try {
            const id = pathId(req);
            if (!id) return next(new NotFoundError("Unknown user"));
            const user = container.repos.users.findById(id);
            if (!user) return next(new NotFoundError("Unknown user"));
            container.repos.users.setAccountStatus(user.id, "Locked");
            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    }
);

router.post(
    "/:id/role",
    auditMiddleware(AuditActions.AdminUserRoleChanged, {
        target: (req) => (pathId(req) ? { type: "user", id: pathId(req)! } : null),
    }),
    (req, res, next) => {
    try {
        const id = pathId(req);
        if (!id) return next(new NotFoundError("Unknown user"));
        const role = (req.body || {}).role;
        if (!isNonEmptyString(role, 16) || (role !== "customer" && role !== "admin"))
            return next(new BadRequestError("Invalid role"));
        const user = container.repos.users.findById(id);
        if (!user) return next(new NotFoundError("Unknown user"));
        container.repos.users.setRole(user.id, role);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /admin/users/:id/recovery-code
 *
 * Mints a fresh single-use recovery code for the given customer. Returns
 * the plaintext exactly once; a bcrypt hash is the only thing kept on the
 * server. Code TTL is 24h; the audit row records issuer + target.
 */
router.post(
    "/:id/recovery-code",
    // OTP is the sole sensitive-action proof on this admin route — no
    // step-up because admins aren't required to keep a passkey for routine
    // writes. The two-token doctrine still applies in spirit: the email
    // factor proves the admin is the actual logged-in admin, not just a
    // session-cookie thief.
    requireOtp("admin.recovery"),
    auditMiddleware(AuditActions.AdminRecoveryCodeIssued, {
        target: (req) => (pathId(req) ? { type: "user", id: pathId(req)! } : null),
    }),
    (req, res, next) => {
        try {
            const id = pathId(req);
            if (!id) return next(new NotFoundError("Unknown user"));
            const admin = req.user!;
            const target = container.repos.users.findById(id);
            if (!target) return next(new NotFoundError("Unknown user"));

            const { code, record } = issueRecoveryCode(
                {
                    repo: container.repos.recoveryCodes,
                    users: container.repos.users,
                    ids: container.ids,
                    clock: container.clock,
                    bus: container.bus,
                },
                { userId: target.id, adminUserId: admin.id }
            );
            res.json({
                code,
                expiresAt: record.expiresAt.toISOString(),
                purpose: record.purpose,
                userId: target.id,
                username: target.username,
            });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
