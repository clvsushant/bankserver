import express from "express";
import {
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
    PublicKeyCredentialRequestOptionsJSON,
    AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { rateLimit } from "../../../middleware/rate-limit";
import { isNonEmptyString, isUuid } from "../../../utils/validate";
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
} from "../../../utils/errors";
import { container } from "../../../container";
import {
    bindUser,
    deleteSession,
    deleteSessionsByUser,
    hasSession,
    listSessionsByUser,
} from "../../../crypto/sessionStore";
import { requireSession } from "../../../middleware/auth";
import { requireStepUp } from "../../../middleware/step-up";
import { signupUser } from "../application/registerUser";
import { loginWithPassword } from "../application/login";
import { changePassword } from "../application/changePassword";
import { consumeRecoveryCode } from "../application/recoveryCodes";
import {
    clearLoginState,
    consumeLoginState,
    peekLoginState,
    setLoginState,
} from "../application/loginStateMachine";
import {
    AccountLockedError,
    InvalidCredentialsError,
    InvalidEmailError,
    UnknownUserError,
    UsernameTakenError,
    WeakPasswordError,
} from "../domain/errors";
import { auditFromRequest } from "../../audit/interface/recordFromRequest";
import { auditMiddleware } from "../../audit/interface/middleware";
import { AuditActions } from "../../audit/domain/actions";
import { requireOtp } from "../../../middleware/otp";
import {
    isOtpRequired,
    requestOtp,
    verifyOtp,
} from "../../../services/otpService";
import { mintOtpToken } from "../../../services/otpTokens";
import { hashActionParams } from "../../../services/actionTokens";

/**
 * Identity / 2FA login.
 *
 *   POST /identity/signup                  — username + email + password
 *   POST /identity/login/password          — verify password, set state, return nextStep
 *   POST /identity/login/passkey/options   — second factor (existing user)
 *   POST /identity/login/passkey/verify    — bind user to session
 *
 * The /webauthn/registration/* endpoints are gated by the same login state
 * (see [routes/webauthn.ts]) so first-time passkey enrollment only works
 * after a successful password step.
 */

const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:5174";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface PasskeyChallenge {
    challenge: string;
    expiresAt: number;
}
const passkeyChallenges = new Map<string, PasskeyChallenge>();
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of passkeyChallenges) if (now > v.expiresAt) passkeyChallenges.delete(k);
}, 60_000).unref();

const limiter = rateLimit({ windowMs: 60_000, max: 30 });
const router = express.Router();

router.post("/signup", limiter, async (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const username = body.username as unknown;
        const email = body.email as unknown;
        const password = body.password as unknown;

        if (!isNonEmptyString(username, 64) || !isNonEmptyString(email, 254))
            return next(new BadRequestError("Invalid signup"));
        if (typeof password !== "string")
            return next(new BadRequestError("Password is required"));

        try {
            const user = await signupUser(
                { userRepo: container.repos.users, ids: container.ids, clock: container.clock },
                { username, email, password, role: "customer" }
            );
            auditFromRequest(req, {
                action: AuditActions.AuthSignup,
                actor: { userId: user.id, username: user.username, role: "customer" },
                target: { type: "user", id: user.id },
                status: "success",
                summary: `Signup for ${user.username}`,
                payload: { username: user.username, email },
            });
            res.status(201).json({
                userId: user.id,
                username: user.username,
                role: user.role,
            });
        } catch (e) {
            auditFromRequest(req, {
                action: AuditActions.AuthSignup,
                actor: { username: typeof username === "string" ? username : undefined, role: "anonymous" },
                status: "failure",
                errorCode: e instanceof Error ? e.constructor.name : "Error",
                summary: `Signup failed for ${typeof username === "string" ? username : "<unknown>"}`,
                payload: { username, email },
            });
            if (e instanceof UsernameTakenError)
                return next(new ConflictError("Username already taken"));
            if (e instanceof InvalidEmailError) return next(new BadRequestError("Invalid email"));
            if (e instanceof WeakPasswordError) return next(new BadRequestError(e.message));
            return next(e);
        }
    } catch (err) {
        next(err);
    }
});

router.post("/login/password", limiter, async (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const username = body.username as unknown;
        const password = body.password as unknown;
        const sessionId = body.sessionId as unknown;

        if (!isNonEmptyString(username, 64))
            return next(new BadRequestError("Invalid username"));
        if (typeof password !== "string" || password.length === 0)
            return next(new BadRequestError("Password required"));
        if (!isUuid(sessionId)) return next(new BadRequestError("Invalid session"));
        if (!hasSession(sessionId))
            return next(new UnauthorizedError("Session not established"));

        try {
            const result = await loginWithPassword(
                { userRepo: container.repos.users, clock: container.clock },
                { username, password }
            );
            const purpose = result.nextStep === "enroll" ? "enroll-passkey" : "auth-passkey";
            const { nonce, expiresAt } = setLoginState(sessionId, {
                userId: result.user.id,
                username: result.user.username,
                purpose,
            });
            res.json({
                nextStep: result.nextStep,
                username: result.user.username,
                nonce,
                expiresAt,
            });
        } catch (e) {
            // Login failure: capture the *attempted* username so admins can
            // investigate brute-force probes and locked-account events.
            const reason =
                e instanceof AccountLockedError
                    ? "locked"
                    : e instanceof InvalidCredentialsError
                    ? "bad_password_or_user"
                    : "error";
            auditFromRequest(req, {
                action: AuditActions.AuthLoginFailure,
                actor: {
                    username: typeof username === "string" ? username : undefined,
                    role: "anonymous",
                },
                sessionId: typeof sessionId === "string" ? sessionId : undefined,
                status: "failure",
                errorCode: reason,
                summary: `Login failed (${reason}) for ${
                    typeof username === "string" ? username : "<unknown>"
                }`,
                payload: { username, reason },
            });
            if (e instanceof AccountLockedError)
                return next(new ForbiddenError("Account is locked. Contact an admin."));
            if (e instanceof InvalidCredentialsError)
                return next(new UnauthorizedError("Invalid credentials"));
            return next(e);
        }
    } catch (err) {
        next(err);
    }
});

/**
 * POST /identity/login/recovery — enroll-additional bootstrap path.
 *
 * Scenario: user signed up + enrolled a passkey on Device A, lost access to
 * it (or just doesn't have it on Device B). Admin issued them a one-shot
 * recovery code out-of-band. They submit username + password + code here;
 * if all three check out the server creates an `enroll-additional` login
 * state, the client runs a fresh registration ceremony, and a new passkey
 * lands on Device B without ever flipping `passkeyEnrolled` (already true).
 *
 * Security note: password is REQUIRED — recovery code alone never bootstraps
 * a new credential. The combination is roughly equivalent in strength to
 * "password + email link" used elsewhere; the code is bcrypt-hashed at rest
 * and single-use.
 */
router.post("/login/recovery", limiter, async (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const username = body.username as unknown;
        const password = body.password as unknown;
        const code = body.code as unknown;
        const sessionId = body.sessionId as unknown;

        if (!isNonEmptyString(username, 64))
            return next(new BadRequestError("Invalid username"));
        if (typeof password !== "string" || password.length === 0)
            return next(new BadRequestError("Password required"));
        if (!isNonEmptyString(code, 64))
            return next(new BadRequestError("Recovery code required"));
        if (!isUuid(sessionId)) return next(new BadRequestError("Invalid session"));
        if (!hasSession(sessionId))
            return next(new UnauthorizedError("Session not established"));

        const failureAudit = (reason: string) => {
            auditFromRequest(req, {
                action: AuditActions.AuthRecoveryConsumedFailure,
                actor: { username, role: "anonymous" },
                sessionId,
                status: "failure",
                errorCode: reason,
                summary: `Recovery attempt failed (${reason}) for ${username}`,
                payload: { username, reason },
            });
        };

        let user;
        try {
            const result = await loginWithPassword(
                { userRepo: container.repos.users, clock: container.clock },
                { username, password }
            );
            user = result.user;
        } catch (e) {
            failureAudit(
                e instanceof AccountLockedError
                    ? "locked"
                    : e instanceof InvalidCredentialsError
                    ? "bad_password_or_user"
                    : "error"
            );
            if (e instanceof AccountLockedError)
                return next(new ForbiddenError("Account is locked. Contact an admin."));
            if (e instanceof InvalidCredentialsError)
                return next(new UnauthorizedError("Invalid credentials"));
            return next(e);
        }

        const consumed = consumeRecoveryCode(
            {
                repo: container.repos.recoveryCodes,
                clock: container.clock,
                bus: container.bus,
            },
            { userId: user.id, code }
        );
        if (!consumed) {
            failureAudit("invalid_recovery_code");
            return next(new ForbiddenError("Invalid or expired recovery code"));
        }

        const { nonce, expiresAt } = setLoginState(sessionId, {
            userId: user.id,
            username: user.username,
            purpose: "enroll-additional",
        });
        res.json({
            nextStep: "enroll-additional",
            username: user.username,
            nonce,
            expiresAt,
        });
    } catch (err) {
        next(err);
    }
});

router.post("/login/passkey/options", limiter, async (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const sessionId = body.sessionId as unknown;
        const nonce = body.nonce as unknown;

        if (!isUuid(sessionId)) return next(new BadRequestError("Invalid session"));
        if (typeof nonce !== "string") return next(new BadRequestError("Invalid nonce"));
        if (!hasSession(sessionId))
            return next(new UnauthorizedError("Session not established"));

        const state = peekLoginState(sessionId, "auth-passkey");
        if (!state || state.nonce !== nonce)
            return next(new ForbiddenError("Login state expired or invalid"));

        const credentials = container.repos.credentials.listByUserId(state.userId);
        if (credentials.length === 0)
            return next(new NotFoundError("User has no registered credentials"));

        const options: PublicKeyCredentialRequestOptionsJSON = await generateAuthenticationOptions({
            rpID: RP_ID,
            allowCredentials: credentials.map((c) => ({ id: c.id, transports: c.transports })),
            userVerification: "required",
        });

        passkeyChallenges.set(sessionId, {
            challenge: options.challenge,
            expiresAt: Date.now() + CHALLENGE_TTL_MS,
        });

        res.json(options);
    } catch (err) {
        next(err);
    }
});

/**
 * Hydration probe used on app boot. Returns the bound user for the current
 * encrypted session or 401 if no user has been bound (i.e. the client has a
 * valid AES key but never finished a passkey login).
 */
router.get("/me", requireSession, (req, res) => {
    const u = req.user!;
    res.json({ user: { id: u.id, username: u.username, role: u.role } });
});

/**
 * Sign out: tears down the encrypted session server-side. The client is
 * responsible for wiping its own sessionStorage + IDB key entry. Subsequent
 * requests against this sessionId will fail at `decryptMiddleware`.
 */
router.post("/logout", requireSession, (req, res) => {
    const sessionId = req.sessionId!;
    const user = req.user!;
    auditFromRequest(req, {
        action: AuditActions.AuthLogout,
        actor: { userId: user.id, username: user.username, role: user.role },
        sessionId,
        target: { type: "user", id: user.id },
        status: "success",
        summary: `Logout for ${user.username}`,
    });
    clearLoginState(sessionId);
    deleteSession(sessionId);
    res.json({ success: true });
});

router.post("/login/passkey/verify", limiter, async (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const sessionId = body.sessionId as unknown;
        const nonce = body.nonce as unknown;
        const response = body.response as unknown;

        if (!isUuid(sessionId)) return next(new BadRequestError("Invalid session"));
        if (typeof nonce !== "string") return next(new BadRequestError("Invalid nonce"));
        if (!response || typeof response !== "object")
            return next(new BadRequestError("Invalid response"));
        if (!hasSession(sessionId))
            return next(new UnauthorizedError("Session not established"));

        const state = consumeLoginState(sessionId, "auth-passkey");
        if (!state || state.nonce !== nonce)
            return next(new ForbiddenError("Login state expired or invalid"));

        const stored = passkeyChallenges.get(sessionId);
        passkeyChallenges.delete(sessionId);
        if (!stored || Date.now() > stored.expiresAt)
            return next(new ForbiddenError("No passkey challenge"));

        const credId = (response as { id?: unknown }).id;
        if (typeof credId !== "string")
            return next(new BadRequestError("Missing credential id"));
        const cred = container.repos.credentials.findById(credId);
        if (!cred || cred.userId !== state.userId)
            return next(new ForbiddenError("Unknown credential"));

        const verification = await verifyAuthenticationResponse({
            response: response as AuthenticationResponseJSON,
            expectedChallenge: stored.challenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            credential: {
                id: cred.id,
                publicKey: new Uint8Array(cred.publicKey),
                counter: cred.counter,
                transports: cred.transports,
            },
            requireUserVerification: true,
        });
        if (!verification.verified) return next(new ForbiddenError("Assertion not verified"));

        container.repos.credentials.updateUsage(
            cred.id,
            container.clock.now(),
            verification.authenticationInfo.newCounter
        );

        const user = container.repos.users.findById(state.userId);
        if (!user) return next(new NotFoundError("Unknown user"));
        bindUser(sessionId, user.id);

        // Two audit rows: passkey-authenticated (the WebAuthn assertion was
        // accepted) and login-success (the user is now bound to a session).
        auditFromRequest(req, {
            action: AuditActions.AuthPasskeyAuthenticated,
            actor: { userId: user.id, username: user.username, role: user.role },
            sessionId,
            target: { type: "user", id: user.id },
            status: "success",
            summary: `Passkey assertion verified for ${user.username}`,
            payload: { credentialId: cred.id },
        });
        auditFromRequest(req, {
            action: AuditActions.AuthLoginSuccess,
            actor: { userId: user.id, username: user.username, role: user.role },
            sessionId,
            target: { type: "user", id: user.id },
            status: "success",
            summary: `Login success for ${user.username}`,
        });

        res.json({
            verified: true,
            user: { id: user.id, username: user.username, role: user.role },
        });
    } catch (err) {
        next(err);
    }
});

// ---------- Email OTP factor (additive to step-up) ----------

/**
 * POST /identity/otp/request
 *
 * The first half of the OTP factor for sensitive identity actions. Body:
 * `{ action, params }` where `action` MUST be a member of
 * `OTP_REQUIRED_ACTIONS` (see `services/otpService.ts`). The server mints a
 * 6-digit code keyed to `(sessionId, action, paramsHash)`, hands it to
 * `container.otpDelivery.send` (logs in stub mode, SMTP later), and
 * returns `{ requestId, expiresAt, deliveredVia }` so the UI can render a
 * matching prompt.
 *
 * The plaintext code is NEVER returned in the response — the client gets
 * it from the delivery channel (real email, or server logs in stub mode).
 */
router.post(
    "/otp/request",
    requireSession,
    limiter,
    auditMiddleware(AuditActions.AuthOtpRequested),
    async (req, res, next) => {
        try {
            const user = req.user!;
            const sessionId = req.sessionId!;
            const body = (req.body || {}) as Record<string, unknown>;
            const action = body.action;
            const params = body.params ?? {};
            if (!isNonEmptyString(action, 64))
                return next(new BadRequestError("Invalid action"));
            if (!isOtpRequired(action))
                return next(new BadRequestError("Action does not require OTP"));

            // `req.user` is the trimmed projection from `requireSession`;
            // re-read for the email field needed by the delivery provider.
            const fullUser = container.repos.users.findById(user.id);
            if (!fullUser) return next(new UnauthorizedError("Login required"));

            const result = requestOtp({ sessionId, action, params, userId: user.id });
            await container.otpDelivery.send({
                userId: user.id,
                username: user.username,
                email: fullUser.email,
                code: result.code,
                action,
                expiresAt: new Date(result.expiresAt),
            });
            res.json({
                requestId: result.requestId,
                expiresAt: result.expiresAt,
                cooldownUntil: result.cooldownUntil,
                deliveredVia: container.otpDelivery.id,
                resent: result.resent,
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * POST /identity/otp/verify
 *
 * The second half of the OTP factor. Body: `{ action, params, code }`.
 * On success we mint a 60-s, single-use, HMAC-signed `otpToken` bound to
 * the same `(action, sessionId, paramsHash)` triple, which the client
 * sends back as `x-otp-token` on the actual sensitive endpoint alongside
 * the existing `x-action-token`.
 *
 * Failures are explicitly audited as `auth.otp.failed` so admins can spot
 * brute-force probes (the in-memory slot also auto-locks after 5 misses).
 */
router.post(
    "/otp/verify",
    requireSession,
    limiter,
    async (req, res, next) => {
        try {
            const user = req.user!;
            const sessionId = req.sessionId!;
            const body = (req.body || {}) as Record<string, unknown>;
            const action = body.action;
            const params = body.params ?? {};
            const code = body.code;
            if (!isNonEmptyString(action, 64))
                return next(new BadRequestError("Invalid action"));
            if (!isNonEmptyString(code, 16))
                return next(new BadRequestError("Invalid code"));
            if (!isOtpRequired(action))
                return next(new BadRequestError("Action does not require OTP"));

            const outcome = verifyOtp({
                sessionId,
                action,
                params,
                code,
                userId: user.id,
            });
            if (!outcome.ok) {
                auditFromRequest(req, {
                    action: AuditActions.AuthOtpFailed,
                    actor: { userId: user.id, username: user.username, role: user.role },
                    sessionId,
                    target: { type: "user", id: user.id },
                    status: "failure",
                    errorCode: outcome.reason,
                    summary: `OTP verify failed (${outcome.reason}) for ${user.username} action=${action}`,
                    payload: { action, reason: outcome.reason },
                });
                return next(new ForbiddenError(`OTP ${outcome.reason}`));
            }

            const paramsHash = hashActionParams(params);
            const { token, exp } = mintOtpToken({ action, sessionId, paramsHash });
            auditFromRequest(req, {
                action: AuditActions.AuthOtpVerified,
                actor: { userId: user.id, username: user.username, role: user.role },
                sessionId,
                target: { type: "user", id: user.id },
                status: "success",
                summary: `OTP verified for ${user.username} action=${action}`,
                payload: { action },
            });
            res.json({ otpToken: token, expiresAt: exp });
        } catch (err) {
            next(err);
        }
    }
);

// ---------- Phase 4 #1: Profile & Security ----------

/**
 * POST /identity/password/change — requires session + OTP + step-up.
 * Expects { oldPassword, newPassword }. Bumps the password hash and
 * resets failed-attempt state. OTP and step-up are independent factors
 * (see `.cursor/rules/otp-additive.mdc`).
 */
router.post(
    "/password/change",
    requireSession,
    requireOtp("password.change"),
    requireStepUp("password.change"),
    auditMiddleware(AuditActions.AuthPasswordChanged),
    async (req, res, next) => {
        try {
            const user = req.user!;
            const body = (req.body || {}) as Record<string, unknown>;
            const oldPassword = body.oldPassword;
            const newPassword = body.newPassword;
            if (typeof oldPassword !== "string" || oldPassword.length === 0)
                return next(new BadRequestError("oldPassword required"));
            if (typeof newPassword !== "string" || newPassword.length === 0)
                return next(new BadRequestError("newPassword required"));

            try {
                await changePassword(
                    { userRepo: container.repos.users },
                    { userId: user.id, oldPassword, newPassword }
                );
                container.bus.publish([
                    {
                        type: "PasswordChanged",
                        userId: user.id,
                        username: user.username,
                        changedAt: container.clock.now(),
                    } as unknown as { type: string },
                ]);
                res.json({ success: true });
            } catch (e) {
                if (e instanceof UnknownUserError) return next(new NotFoundError("User not found"));
                if (e instanceof InvalidCredentialsError)
                    return next(new UnauthorizedError("Current password is incorrect"));
                if (e instanceof WeakPasswordError) return next(new BadRequestError(e.message));
                return next(e);
            }
        } catch (err) {
            next(err);
        }
    }
);

/** GET /identity/sessions — list bound sessions for the current user. */
router.get("/sessions", requireSession, (req, res, next) => {
    try {
        const user = req.user!;
        const currentSessionId = req.sessionId!;
        const sessions = listSessionsByUser(user.id).map((s) => ({
            sessionId: s.sessionId,
            isCurrent: s.sessionId === currentSessionId,
            createdAt: new Date(s.createdAt).toISOString(),
            lastUsedAt: new Date(s.lastUsedAt).toISOString(),
        }));
        res.json({ sessions });
    } catch (err) {
        next(err);
    }
});

/** POST /identity/sessions/wipe-others — revoke every other bound session. */
router.post(
    "/sessions/wipe-others",
    requireSession,
    requireOtp("session.wipe"),
    requireStepUp("session.wipe"),
    auditMiddleware(AuditActions.AuthSessionsWiped),
    (req, res, next) => {
        try {
            const user = req.user!;
            const currentSessionId = req.sessionId!;
            const wiped = deleteSessionsByUser(user.id, currentSessionId);
            res.json({ success: true, wiped });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
