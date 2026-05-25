import crypto from "crypto";

/**
 * Tracks "password verified, awaiting passkey" state across the 2FA login
 * flow. Keyed by encrypted-session id. Pure in-memory; resets on process
 * restart, which is fine for short-lived login flows.
 *
 * State machine:
 *
 *   POST /identity/login/password    -> create entry { purpose: enroll | auth }
 *   POST /identity/login/recovery    -> create entry { purpose: enroll-additional }
 *   POST /identity/credentials/      -> create entry { purpose: enroll-additional }
 *           enroll-options             (after a fresh step-up assertion)
 *   POST /webauthn/registration/*    -> require entry.purpose in
 *                                       { enroll-passkey, enroll-additional }
 *   POST /identity/login/passkey/*   -> require entry.purpose === "auth-passkey"
 *
 * On success of the verify step, the entry is consumed (single-use).
 *
 * Note that `enroll-additional` is what makes multi-device passkey support
 * possible: it tells the registration verify path "this user already has at
 * least one credential — insert another, but DO NOT toggle passkeyEnrolled
 * (which is already true)".
 */

export type LoginPurpose = "enroll-passkey" | "auth-passkey" | "enroll-additional";

export interface LoginState {
    userId: string;
    username: string;
    purpose: LoginPurpose;
    /** Random nonce returned to the client, expected back on the next step. */
    nonce: string;
    expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const stateBySession = new Map<string, LoginState>();

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of stateBySession) if (now > v.expiresAt) stateBySession.delete(k);
}, 60_000).unref();

export function setLoginState(
    sessionId: string,
    state: Omit<LoginState, "expiresAt" | "nonce">
): { nonce: string; expiresAt: number } {
    const nonce = crypto.randomBytes(16).toString("base64url");
    const expiresAt = Date.now() + TTL_MS;
    stateBySession.set(sessionId, { ...state, nonce, expiresAt });
    return { nonce, expiresAt };
}

/** Read without consuming. Used by /options endpoints. */
export function peekLoginState(
    sessionId: string,
    purpose: LoginPurpose
): LoginState | undefined {
    const v = stateBySession.get(sessionId);
    if (!v) return undefined;
    if (Date.now() > v.expiresAt) {
        stateBySession.delete(sessionId);
        return undefined;
    }
    if (v.purpose !== purpose) return undefined;
    return v;
}

/** Read AND consume. Used by /verify endpoints. */
export function consumeLoginState(
    sessionId: string,
    purpose: LoginPurpose
): LoginState | undefined {
    const v = peekLoginState(sessionId, purpose);
    if (!v) return undefined;
    stateBySession.delete(sessionId);
    return v;
}

/** Best-effort cleanup. */
export function clearLoginState(sessionId: string): void {
    stateBySession.delete(sessionId);
}

/** Test helper. */
export function _resetLoginStateMachine(): void {
    stateBySession.clear();
}
