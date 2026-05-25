import express from "express";
import { container } from "../container";
import { bindUser, hasSession } from "../crypto/sessionStore";
import { devSeedUser } from "../contexts/identity/application/registerUser";
import { isNonEmptyString, isUuid } from "../utils/validate";
import {
    BadRequestError,
    ForbiddenError,
    UnauthorizedError,
} from "../utils/errors";

/**
 * Dev-only login bypass. Disabled when NODE_ENV === "production".
 *
 *   POST /dev/login-as { username, sessionId, role? }
 *
 * Creates the user if missing (with the given role), then binds the user
 * to the encrypted session. Useful for CLI integration tests that can't
 * trigger a WebAuthn gesture.
 *
 * NEVER expose this in production. The route module short-circuits to
 * 403 if NODE_ENV is "production".
 */

const router = express.Router();

router.use((_req, _res, next) => {
    if (process.env.NODE_ENV === "production") {
        return next(new ForbiddenError("Dev endpoints are disabled in production"));
    }
    next();
});

router.post("/login-as", async (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const username = body.username;
        const sessionId = body.sessionId;
        const role = body.role;
        const password = body.password;

        if (!isNonEmptyString(username, 64)) return next(new BadRequestError("Invalid username"));
        if (!isUuid(sessionId)) return next(new BadRequestError("Invalid sessionId"));
        if (role !== undefined && role !== "customer" && role !== "admin")
            return next(new BadRequestError("Invalid role"));
        if (password !== undefined && typeof password !== "string")
            return next(new BadRequestError("Invalid password"));
        if (!hasSession(sessionId))
            return next(new UnauthorizedError("Session not established"));

        const user = await devSeedUser(
            { userRepo: container.repos.users, ids: container.ids, clock: container.clock },
            {
                username,
                role: (role as "customer" | "admin" | undefined) ?? "customer",
                password: typeof password === "string" ? password : undefined,
            }
        );

        // If a role was explicitly provided, force-set it (idempotent).
        if (role && user.role !== role) {
            container.repos.users.setRole(user.id, role as "customer" | "admin");
        }

        bindUser(sessionId, user.id);

        res.json({
            ok: true,
            user: { id: user.id, username: user.username, role: role ?? user.role },
        });
    } catch (err) {
        next(err);
    }
});

/** Reset a user's password (dev-only). Useful when the demo DB has stale users. */
router.post("/reset-password", async (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const username = body.username;
        const password = body.password;
        if (!isNonEmptyString(username, 64))
            return next(new BadRequestError("Invalid username"));
        if (typeof password !== "string" || password.length < 1)
            return next(new BadRequestError("Invalid password"));
        const user = container.repos.users.findByUsername(username);
        if (!user) return next(new BadRequestError("Unknown user"));
        const { hashPassword } = await import(
            "../contexts/identity/application/passwords"
        );
        const hash = await hashPassword(password);
        container.repos.users.setPassword(user.id, hash);
        container.repos.users.setAccountStatus(user.id, "Active");
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

export default router;
