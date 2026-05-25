import bcrypt from "bcrypt";

const COST = 12;

const MIN_LEN = 10;
const MAX_LEN = 128;

/** True if the candidate looks like a bcrypt hash (so we don't double-hash). */
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$.{53}$/;

export interface PasswordValidation {
    ok: boolean;
    reason?: string;
}

/**
 * Returns ok=true if the password meets baseline strength requirements.
 * The rules intentionally err on the strict side for a banking demo:
 *   - 10–128 characters
 *   - at least one lowercase, one uppercase, one digit
 *   - at least one non-alphanumeric character
 */
export function validateStrength(pw: unknown): PasswordValidation {
    if (typeof pw !== "string") return { ok: false, reason: "Password must be a string" };
    if (pw.length < MIN_LEN) return { ok: false, reason: `Password must be at least ${MIN_LEN} chars` };
    if (pw.length > MAX_LEN) return { ok: false, reason: `Password must be at most ${MAX_LEN} chars` };
    if (!/[a-z]/.test(pw)) return { ok: false, reason: "Password needs a lowercase letter" };
    if (!/[A-Z]/.test(pw)) return { ok: false, reason: "Password needs an uppercase letter" };
    if (!/[0-9]/.test(pw)) return { ok: false, reason: "Password needs a digit" };
    if (!/[^A-Za-z0-9]/.test(pw))
        return { ok: false, reason: "Password needs a symbol" };
    return { ok: true };
}

export async function hashPassword(plain: string): Promise<string> {
    if (BCRYPT_RE.test(plain)) {
        // Defensive: refuse to re-hash a hash. Caller bug.
        throw new Error("hashPassword called with a bcrypt hash");
    }
    return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
    if (!hash) return false; // sentinel for legacy users without a password
    if (!BCRYPT_RE.test(hash)) return false;
    try {
        return await bcrypt.compare(plain, hash);
    } catch {
        return false;
    }
}
