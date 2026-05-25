import crypto from "crypto";
import { hashActionParams } from "./actionTokens";

/**
 * Layer 6 (cont.): per-(session, action, params) email-OTP factor.
 *
 * This is the *first* of two parallel proofs required by the OTP-gated
 * routes. The other is the WebAuthn step-up action token. Both are bound to
 * the same `(action, sessionId, paramsHash)` triple so neither factor can
 * be replayed against a different action or session.
 *
 * Storage is in-memory and resets on process restart — fine for short-lived
 * factors (5-min code, 60-s post-verify token). The service knows nothing
 * about HTTP; the route handler picks an `OtpDeliveryProvider` and asks it
 * to surface the code to the user (logs in stub mode, SMTP later).
 */

export const OTP_REQUIRED_ACTIONS: ReadonlySet<string> = new Set([
    "passkey.add",
    "passkey.revoke",
    "password.change",
    "session.wipe",
    // Admin-issued recovery codes — the only sensitive-action proof on this
    // admin route. Not gated by step-up because we don't require admins to
    // have a passkey for routine writes; OTP keeps the bar high.
    "admin.recovery",
]);

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_KEYS = 10_000;

interface Slot {
    requestId: string;
    code: string;
    userId: string;
    createdAt: number;
    expiresAt: number;
    attempts: number;
}

const slots = new Map<string, Slot>();

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of slots) if (now > v.expiresAt) slots.delete(k);
}, 60_000).unref();

function evictIfNeeded() {
    if (slots.size <= MAX_KEYS) return;
    let i = 0;
    const drop = slots.size - MAX_KEYS + 100;
    for (const k of slots.keys()) {
        if (i++ >= drop) break;
        slots.delete(k);
    }
}

function key(sessionId: string, action: string, paramsHash: string): string {
    return `${sessionId}::${action}::${paramsHash}`;
}

function generate6Digit(): string {
    // 6 digits = ~20 bits entropy; rate-limited + 5-attempt cap protects
    // against guessing despite the small space.
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function isOtpRequired(action: string): boolean {
    return OTP_REQUIRED_ACTIONS.has(action);
}

export interface RequestArgs {
    sessionId: string;
    action: string;
    params: unknown;
    userId: string;
}

export interface RequestResult {
    requestId: string;
    code: string; // returned to the route so it can hand it to the provider
    expiresAt: number;
    cooldownUntil: number; // earliest time another /request for the same key is allowed
    resent: boolean; // true if this overwrote an existing live slot
}

/**
 * Mints a fresh code for the given (session, action, params). If a live
 * code already exists, a new one is generated only after the resend
 * cooldown — otherwise the existing code is returned. Either way the
 * caller delivers the `code` field via the configured provider.
 */
export function requestOtp(args: RequestArgs): RequestResult {
    evictIfNeeded();
    const paramsHash = hashActionParams(args.params ?? {});
    const k = key(args.sessionId, args.action, paramsHash);
    const now = Date.now();
    const existing = slots.get(k);

    if (existing && now < existing.expiresAt) {
        const cooldownUntil = existing.createdAt + RESEND_COOLDOWN_MS;
        if (now < cooldownUntil) {
            // Honor cooldown: re-emit the SAME code so accidental
            // double-clicks aren't a hard error.
            return {
                requestId: existing.requestId,
                code: existing.code,
                expiresAt: existing.expiresAt,
                cooldownUntil,
                resent: true,
            };
        }
    }

    const code = generate6Digit();
    const slot: Slot = {
        requestId: crypto.randomUUID(),
        code,
        userId: args.userId,
        createdAt: now,
        expiresAt: now + TTL_MS,
        attempts: 0,
    };
    slots.set(k, slot);
    return {
        requestId: slot.requestId,
        code,
        expiresAt: slot.expiresAt,
        cooldownUntil: slot.createdAt + RESEND_COOLDOWN_MS,
        resent: existing ? now >= existing.expiresAt : false,
    };
}

export type VerifyOutcome =
    | { ok: true; userId: string }
    | { ok: false; reason: "missing" | "expired" | "locked" | "mismatch" };

export interface VerifyArgs {
    sessionId: string;
    action: string;
    params: unknown;
    code: string;
    userId: string;
}

/**
 * Verifies a code and consumes the slot on success. Increments the attempt
 * counter on miss; locks the slot once `MAX_ATTEMPTS` is reached so brute-
 * forcing a 6-digit space is bounded.
 *
 * Stub bypass: when `OTP_STUB_BYPASS=true` and the literal code `000000` is
 * submitted, the slot is consumed without an attempt charge. Production
 * never sets the env. The bypass requires that a slot already exist —
 * verification still requires a `requestOtp` call first.
 */
export function verifyOtp(args: VerifyArgs): VerifyOutcome {
    const paramsHash = hashActionParams(args.params ?? {});
    const k = key(args.sessionId, args.action, paramsHash);
    const now = Date.now();
    const slot = slots.get(k);
    if (!slot) return { ok: false, reason: "missing" };
    if (now > slot.expiresAt) {
        slots.delete(k);
        return { ok: false, reason: "expired" };
    }
    if (slot.attempts >= MAX_ATTEMPTS) {
        return { ok: false, reason: "locked" };
    }
    if (slot.userId !== args.userId) {
        // The slot was created by a different bound user. Treat as a miss
        // without attempt charge — the legitimate slot is still safe.
        return { ok: false, reason: "mismatch" };
    }

    const stubBypass =
        process.env.OTP_STUB_BYPASS === "true" && args.code === "000000";

    if (!stubBypass) {
        const submitted = Buffer.from(args.code.padStart(6, "0"));
        const expected = Buffer.from(slot.code);
        const equal =
            submitted.length === expected.length &&
            crypto.timingSafeEqual(submitted, expected);
        if (!equal) {
            slot.attempts += 1;
            return { ok: false, reason: "mismatch" };
        }
    }

    slots.delete(k);
    return { ok: true, userId: slot.userId };
}

export function _resetOtp(): void {
    slots.clear();
}
