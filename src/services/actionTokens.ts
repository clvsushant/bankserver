import crypto from "crypto";

/**
 * Layer 6: one-shot, server-issued, action-bound tokens.
 *
 * The server mints a token after a successful step-up (e.g. WebAuthn assertion)
 * that binds:
 *   - the action name ("transfer")
 *   - a hash of the action parameters (so the user can't be tricked into
 *     authorizing one transfer while a malicious payload is sent)
 *   - the sessionId
 *   - an expiry (60 s)
 *
 * The token is HMAC-SHA-256 signed with a process-local key. It can be used
 * exactly once (server tracks consumed tokens by jti).
 *
 * In production, the HMAC key should be a 32-byte secret loaded from env /
 * secret manager so multiple backend nodes can verify tokens minted by any
 * other node.
 */

const HMAC_KEY = (() => {
    const fromEnv = process.env.ACTION_TOKEN_HMAC_KEY;
    if (fromEnv && fromEnv.length >= 32) return Buffer.from(fromEnv, "utf8");
    return crypto.randomBytes(32);
})();

const TOKEN_TTL_MS = 60 * 1000;
const MAX_LIVE_TOKENS = 10_000;

interface MintedToken {
    jti: string;
    action: string;
    paramsHash: string;
    sessionId: string;
    iat: number;
    exp: number;
}

const consumedJti = new Set<string>();

function jtiBucket() {
    if (consumedJti.size > MAX_LIVE_TOKENS) consumedJti.clear();
}

function sign(token: MintedToken): string {
    const body = Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
    const mac = crypto.createHmac("sha256", HMAC_KEY).update(body).digest("base64url");
    return `${body}.${mac}`;
}

function verify(token: string): MintedToken | null {
    const dot = token.indexOf(".");
    if (dot < 0) return null;
    const body = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    const expected = crypto.createHmac("sha256", HMAC_KEY).update(body).digest("base64url");
    // Constant-time comparison.
    const a = Buffer.from(mac, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MintedToken;
    } catch {
        return null;
    }
}

export function hashActionParams(params: unknown): string {
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(params ?? null))
        .digest("base64url");
}

export interface MintOptions {
    action: string;
    sessionId: string;
    paramsHash: string;
}

export function mintActionToken({ action, sessionId, paramsHash }: MintOptions): {
    token: string;
    exp: number;
} {
    jtiBucket();
    const now = Date.now();
    const minted: MintedToken = {
        jti: crypto.randomUUID(),
        action,
        paramsHash,
        sessionId,
        iat: now,
        exp: now + TOKEN_TTL_MS,
    };
    return { token: sign(minted), exp: minted.exp };
}

export interface VerifyOptions {
    expectedAction: string;
    expectedSessionId: string;
    expectedParamsHash: string;
}

export type VerifyResult =
    | { ok: true }
    | { ok: false; reason: "malformed" | "expired" | "consumed" | "mismatch" };

export function consumeActionToken(token: string, opts: VerifyOptions): VerifyResult {
    const minted = verify(token);
    if (!minted) return { ok: false, reason: "malformed" };
    if (Date.now() > minted.exp) return { ok: false, reason: "expired" };
    if (consumedJti.has(minted.jti)) return { ok: false, reason: "consumed" };
    if (
        minted.action !== opts.expectedAction ||
        minted.sessionId !== opts.expectedSessionId ||
        minted.paramsHash !== opts.expectedParamsHash
    ) {
        return { ok: false, reason: "mismatch" };
    }
    consumedJti.add(minted.jti);
    return { ok: true };
}

// Test helper.
export function _resetActionTokens(): void {
    consumedJti.clear();
}
