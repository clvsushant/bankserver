/**
 * Admin-issued one-shot proof a user is who they claim to be when all of
 * their existing passkeys are unreachable. The plaintext code is shown to
 * the admin exactly once at issue-time and then bcrypt-hashed at rest.
 *
 * Exactly one purpose today: bootstrapping an additional passkey on a new
 * device. The enum is kept open so other recovery flows (e.g.
 * password-reset) can reuse the table if desired.
 */
export type RecoveryCodePurpose = "passkey-add";

export interface RecoveryCode {
    readonly id: string;
    readonly userId: string;
    readonly codeHash: string;
    readonly issuedAt: Date;
    readonly issuedByAdminId?: string;
    readonly expiresAt: Date;
    readonly consumedAt?: Date;
    readonly purpose: RecoveryCodePurpose;
}

export function isExpired(code: RecoveryCode, now: Date): boolean {
    return now.getTime() > code.expiresAt.getTime();
}

export function isConsumed(code: RecoveryCode): boolean {
    return code.consumedAt !== undefined;
}
