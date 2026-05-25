/**
 * Log-time redactor.
 *
 * Walks an arbitrary JSON-shaped value and returns a deep clone with
 * sensitive fields replaced by short, human-readable placeholders. Intended
 * exclusively for log output — never feed the result back into business
 * logic or send it on the wire.
 *
 * Rule format: `[regex over the property key, mode]`. The regex is matched
 * against each object key as we recurse; the first match wins. Anything
 * that doesn't match is preserved as-is, except very long strings which
 * are summarised by length to keep log lines readable.
 */

type Mode = "hide" | "truncate" | "mask-pan" | "mask-email" | "mask-dob";

const KEY_RULES: Array<[RegExp, Mode]> = [
    // Credentials.
    [/^password$/i, "hide"],
    [/^(?:old|new|current)Password$/i, "hide"],
    [/^actionToken$/i, "hide"],
    // Recovery codes — plaintext only ever travels in the issue response and
    // the consume request; the audit payload must not echo it back.
    [/^code$/i, "hide"],
    [/^recoveryCode$/i, "hide"],
    [/^codeHash$/i, "hide"],
    // OTP factors. The plaintext `otpCode` may briefly appear on /verify;
    // the minted `otpToken` and `actionToken` are bearer credentials that
    // must never appear in audit payloads.
    [/^otpCode$/i, "hide"],
    [/^otpToken$/i, "hide"],

    // Personal identifiers — show enough to correlate, not enough to leak.
    [/^pan$/i, "mask-pan"],
    [/^dob$/i, "mask-dob"],
    [/^email$/i, "mask-email"],

    // Bulky / opaque blobs — replace with a length summary.
    [/^docB64$/i, "truncate"],
    [/^response$/i, "truncate"], // WebAuthn (Registration|Authentication)ResponseJSON
    [/^options$/i, "truncate"], // WebAuthn options blob
    [/Jwk$/i, "truncate"], // serverPublicJwk, clientPublicJwk, etc.
    [/^salt$/i, "truncate"],
    [/^nonce$/i, "truncate"],
    [/^challenge$/i, "truncate"],
    [/^paramsHash$/i, "truncate"],
    [/^idempotencyKey$/i, "truncate"],
    [/^payload$/i, "truncate"],
];

const STRING_TRUNCATE_AT = 256;
const TRUNCATE_SHOW_AT = 32;

function maskPan(value: unknown): string {
    if (typeof value !== "string") return "<masked>";
    if (value.length < 4) return "***";
    return value.slice(0, 2) + "***" + value.slice(-1);
}

function maskEmail(value: unknown): string {
    if (typeof value !== "string" || !value.includes("@")) return "<masked>";
    const at = value.indexOf("@");
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    const head = local.slice(0, 1);
    return `${head}***@${domain}`;
}

function maskDob(value: unknown): string {
    if (typeof value !== "string") return "<masked>";
    // ISO date "1990-04-23" -> "1990-**-**" (keep year only).
    return value.replace(/^(\d{4})-\d{2}-\d{2}$/, "$1-**-**");
}

function applyMode(mode: Mode, value: unknown): unknown {
    switch (mode) {
        case "hide":
            return "<redacted>";
        case "truncate": {
            if (value == null) return value;
            if (typeof value === "string") {
                return value.length > TRUNCATE_SHOW_AT
                    ? `<${value.length} bytes>`
                    : value;
            }
            if (typeof value === "object") return "<object, omitted>";
            return value;
        }
        case "mask-pan":
            return maskPan(value);
        case "mask-email":
            return maskEmail(value);
        case "mask-dob":
            return maskDob(value);
        default:
            return "<masked>";
    }
}

export function redact(value: unknown, key?: string): unknown {
    if (key) {
        for (const [re, mode] of KEY_RULES) {
            if (re.test(key)) return applyMode(mode, value);
        }
    }

    if (Array.isArray(value)) {
        return value.map((v) => redact(v));
    }

    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = redact(v, k);
        }
        return out;
    }

    // Generic safety net: collapse unexpectedly long strings so a single
    // log line never explodes the terminal.
    if (typeof value === "string" && value.length > STRING_TRUNCATE_AT) {
        return `<${value.length} bytes>`;
    }

    return value;
}
