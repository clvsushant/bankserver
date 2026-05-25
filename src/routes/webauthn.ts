import express from "express";
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
    RegistrationResponseJSON,
    AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { rateLimit } from "../middleware/rate-limit";
import { isUuid, isNonEmptyString } from "../utils/validate";
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
} from "../utils/errors";
import { hashActionParams, mintActionToken } from "../services/actionTokens";
import { bindUser, hasSession } from "../crypto/sessionStore";
import { container } from "../container";
import {
    consumeLoginState,
    peekLoginState,
} from "../contexts/identity/application/loginStateMachine";
import { auditFromRequest } from "../contexts/audit/interface/recordFromRequest";
import { AuditActions } from "../contexts/audit/domain/actions";

/**
 * WebAuthn endpoints. Two distinct purposes:
 *
 *   1. Passkey enrollment (first login, gated by /identity/login/password):
 *      POST /webauthn/registration/options { sessionId, nonce } -> options
 *      POST /webauthn/registration/verify  { sessionId, nonce, response }
 *        -> stores credential, marks user.passkeyEnrolled, binds to session.
 *
 *   2. Step-up for a SENSITIVE action (transfer, freeze, ...):
 *      POST /webauthn/authentication/options { username, sessionId, action, params }
 *      POST /webauthn/authentication/verify  { username, response }
 *        -> mints a one-shot action token bound to (action, sessionId, paramsHash).
 *
 * Pure login (already-enrolled users) lives under /identity/login/passkey/*.
 */

const RP_NAME = process.env.WEBAUTHN_RP_NAME || "BankServer Demo";
const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:5174";

interface PendingChallenge {
    challenge: string;
    purpose: "register" | "authenticate";
    sessionId?: string;
    action?: string;
    paramsHash?: string;
    expiresAt: number;
}
const pendingChallenges = new Map<string, PendingChallenge>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of pendingChallenges) if (now > v.expiresAt) pendingChallenges.delete(k);
}, 60_000).unref();

function setChallenge(username: string, value: PendingChallenge) {
    pendingChallenges.set(username, value);
}
function takeChallenge(username: string): PendingChallenge | undefined {
    const v = pendingChallenges.get(username);
    if (!v) return undefined;
    pendingChallenges.delete(username);
    if (Date.now() > v.expiresAt) return undefined;
    return v;
}

const router = express.Router();
const limiter = rateLimit({ windowMs: 60_000, max: 30 });

router.post("/registration/options", limiter, async (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const sessionId = body.sessionId as unknown;
        const nonce = body.nonce as unknown;

        if (!isUuid(sessionId)) return next(new BadRequestError("Invalid session"));
        if (typeof nonce !== "string") return next(new BadRequestError("Invalid nonce"));
        if (!hasSession(sessionId))
            return next(new UnauthorizedError("Session not established"));

        // First-time enrollment OR adding another passkey are both valid here:
        // the difference is only on /verify (whether to flip passkeyEnrolled).
        const state =
            peekLoginState(sessionId, "enroll-passkey") ??
            peekLoginState(sessionId, "enroll-additional");
        if (!state || state.nonce !== nonce)
            return next(new ForbiddenError("Login state expired or invalid"));

        const user = container.repos.users.findById(state.userId);
        if (!user) return next(new NotFoundError("Unknown user"));

        const credentials = container.repos.credentials.listByUserId(user.id);

        const options: PublicKeyCredentialCreationOptionsJSON = await generateRegistrationOptions({
            rpName: RP_NAME,
            rpID: RP_ID,
            userName: user.username,
            userID: new TextEncoder().encode(user.id),
            attestationType: "none",
            authenticatorSelection: {
                residentKey: "preferred",
                userVerification: "required",
            },
            // Both first-enrollment and add-another paths exclude any
            // already-registered authenticator so the platform doesn't
            // offer the same key twice.
            excludeCredentials: credentials.map((c) => ({
                id: c.id,
                transports: c.transports,
            })),
        });

        setChallenge(`enroll:${sessionId}`, {
            challenge: options.challenge,
            purpose: "register",
            sessionId,
            expiresAt: Date.now() + CHALLENGE_TTL_MS,
        });

        res.json(options);
    } catch (err) {
        next(err);
    }
});

router.post("/registration/verify", limiter, async (req, res, next) => {
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

        // Try first-enrollment state first; if absent, fall back to the
        // additional-enrollment state. Whichever matches is consumed.
        const state =
            consumeLoginState(sessionId, "enroll-passkey") ??
            consumeLoginState(sessionId, "enroll-additional");
        if (!state || state.nonce !== nonce)
            return next(new ForbiddenError("Login state expired or invalid"));
        const isAdditional = state.purpose === "enroll-additional";

        const challenge = takeChallenge(`enroll:${sessionId}`);
        if (!challenge || challenge.purpose !== "register")
            return next(new ForbiddenError("No registration challenge"));

        const user = container.repos.users.findById(state.userId);
        if (!user) return next(new NotFoundError("Unknown user"));

        const verification = await verifyRegistrationResponse({
            response: response as RegistrationResponseJSON,
            expectedChallenge: challenge.challenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            requireUserVerification: true,
        });

        if (!verification.verified || !verification.registrationInfo) {
            return next(new ForbiddenError("Registration not verified"));
        }

        const info = verification.registrationInfo;
        container.repos.credentials.insert({
            id: info.credential.id,
            userId: user.id,
            publicKey: info.credential.publicKey,
            counter: info.credential.counter,
            transports: info.credential.transports,
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
            createdAt: container.clock.now(),
        });
        // Only flip the user-level flag on the very first enrollment. For
        // additional-passkey flows the flag is already true and resetting it
        // would force a re-bootstrap on the next login.
        if (!isAdditional) container.repos.users.markPasskeyEnrolled(user.id);
        bindUser(sessionId, user.id);

        if (isAdditional) {
            // Adding another passkey to an existing account. The user is
            // already authenticated for the duration of this request (either
            // by step-up from Settings or by recovery code on Login). Surface
            // a single audit row + bus event so the wildcard subscriber can
            // record it under `auth.passkey.added.additional`.
            container.bus.publish([
                {
                    type: "PasskeyEnrolledAdditional",
                    userId: user.id,
                    username: user.username,
                    credentialId: info.credential.id,
                    enrolledAt: container.clock.now(),
                } as unknown as { type: string },
            ]);
        } else {
            // Newly-enrolled passkey + the user is now bound to the session
            // (this *is* their first login). Record both rows.
            auditFromRequest(req, {
                action: AuditActions.AuthPasskeyEnrolled,
                actor: { userId: user.id, username: user.username, role: user.role },
                sessionId,
                target: { type: "user", id: user.id },
                status: "success",
                summary: `Passkey enrolled for ${user.username}`,
                payload: { credentialId: info.credential.id },
            });
            auditFromRequest(req, {
                action: AuditActions.AuthLoginSuccess,
                actor: { userId: user.id, username: user.username, role: user.role },
                sessionId,
                target: { type: "user", id: user.id },
                status: "success",
                summary: `Login success (post-enrollment) for ${user.username}`,
            });
        }

        res.json({
            verified: true,
            user: { id: user.id, username: user.username, role: user.role },
        });
    } catch (err) {
        next(err);
    }
});

router.post("/authentication/options", limiter, async (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const username = body.username as unknown;
        const sessionId = body.sessionId as unknown;
        const action = body.action as unknown;
        const params = body.params;

        if (!isNonEmptyString(username, 64)) return next(new BadRequestError("Invalid username"));
        if (!isUuid(sessionId)) return next(new BadRequestError("Invalid session"));
        if (!isNonEmptyString(action, 64)) return next(new BadRequestError("Invalid action"));
        if (!hasSession(sessionId))
            return next(new UnauthorizedError("Session not established"));

        const user = container.repos.users.findByUsername(username);
        if (!user) return next(new NotFoundError("Unknown user"));
        const credentials = container.repos.credentials.listByUserId(user.id);
        if (credentials.length === 0)
            return next(new NotFoundError("User has no registered credentials"));

        const options: PublicKeyCredentialRequestOptionsJSON = await generateAuthenticationOptions({
            rpID: RP_ID,
            allowCredentials: credentials.map((c) => ({
                id: c.id,
                transports: c.transports,
            })),
            userVerification: "required",
        });

        const paramsHash = hashActionParams(params);
        setChallenge(user.username, {
            challenge: options.challenge,
            purpose: "authenticate",
            sessionId,
            action,
            paramsHash,
            expiresAt: Date.now() + CHALLENGE_TTL_MS,
        });

        res.json({ options, paramsHash });
    } catch (err) {
        next(err);
    }
});

router.post("/authentication/verify", limiter, async (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const username = body.username as unknown;
        const response = body.response as unknown;

        if (!isNonEmptyString(username, 64)) return next(new BadRequestError("Invalid username"));
        if (!response || typeof response !== "object")
            return next(new BadRequestError("Invalid response"));

        const challenge = takeChallenge(username);
        if (!challenge || challenge.purpose !== "authenticate")
            return next(new ForbiddenError("No authentication challenge"));

        const user = container.repos.users.findByUsername(username);
        if (!user) return next(new NotFoundError("Unknown user"));

        const credId = (response as { id?: unknown }).id;
        if (typeof credId !== "string")
            return next(new BadRequestError("Missing credential id"));
        const cred = container.repos.credentials.findById(credId);
        if (!cred || cred.userId !== user.id)
            return next(new ForbiddenError("Unknown credential"));

        const verification = await verifyAuthenticationResponse({
            response: response as AuthenticationResponseJSON,
            expectedChallenge: challenge.challenge,
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

        const { token, exp } = mintActionToken({
            action: challenge.action!,
            sessionId: challenge.sessionId!,
            paramsHash: challenge.paramsHash!,
        });

        res.json({ verified: true, actionToken: token, expiresAt: exp });
    } catch (err) {
        next(err);
    }
});

export default router;
