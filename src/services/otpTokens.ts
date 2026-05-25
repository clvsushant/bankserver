import crypto from "crypto";

/**
 * One-shot, server-issued, action-bound OTP tokens.
 *
 * Structural mirror of [`actionTokens.ts`](./actionTokens.ts) but with a
 * SEPARATE HMAC key so a leaked action token can never satisfy `requireOtp`
 * (and vice versa). Independence of the two keys is the load-bearing
 * guarantee that lets us treat OTP and step-up as truly additive factors.
 *
 * Token shape:
 *   - jti           — random UUID, tracked in a consumed-set for single-use
 *   - action        — the gated action name (e.g. "passkey.add")
 *   - paramsHash    — sha256 of canonical request body
 *   - sessionId     — the encrypted-session this token is valid for
 *   - iat / exp     — 60-second lifetime
 */

const HMAC_KEY = (() => {
    const fromEnv = process.env.OTP_TOKEN_HMAC_KEY;
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
    const a = Buffer.from(mac, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MintedToken;
    } catch {
        return null;
    }
}

export interface MintOptions {
    action: string;
    sessionId: string;
    paramsHash: string;
}

export function mintOtpToken({ action, sessionId, paramsHash }: MintOptions): {
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

export function consumeOtpToken(token: string, opts: VerifyOptions): VerifyResult {
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

export function _resetOtpTokens(): void {
    consumedJti.clear();
}
