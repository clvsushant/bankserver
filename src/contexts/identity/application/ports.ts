import type { User, Role, AccountStatus } from "../domain/user";
import type { WebAuthnCredential } from "../domain/credential";
import type { RecoveryCode } from "../domain/recoveryCode";

export interface UserRepo {
    findById(id: string): User | undefined;
    findByUsername(username: string): User | undefined;
    listAll(): User[];
    insert(user: User): void;
    setRole(id: string, role: Role): void;
    setAccountStatus(id: string, status: AccountStatus): void;
    setPassword(id: string, passwordHash: string): void;
    markPasskeyEnrolled(id: string): void;
    /**
     * Atomically increment failedAttempts and (optionally) set lockedUntil
     * — used by the password-login flow.
     */
    recordFailedAttempt(id: string, lockedUntil: Date | undefined): void;
    resetFailedAttempts(id: string): void;
}

export interface CredentialRepo {
    findById(id: string): WebAuthnCredential | undefined;
    listByUserId(userId: string): WebAuthnCredential[];
    countByUserId(userId: string): number;
    insert(cred: WebAuthnCredential): void;
    updateCounter(id: string, counter: number): void;
    /** Bumps both counter and lastUsedAt (called from passkey verify paths). */
    updateUsage(id: string, lastUsedAt: Date, counter: number): void;
    /** Set or clear a friendly label. */
    setLabel(id: string, label: string | undefined): void;
    /** Hard-delete a credential (revoke from settings). */
    delete(id: string): void;
}

export interface RecoveryCodeRepo {
    insert(code: RecoveryCode): void;
    /** Active = unconsumed AND not expired. Newest first. */
    listActiveByUserId(userId: string, now: Date): RecoveryCode[];
    findById(id: string): RecoveryCode | undefined;
    /** Marks the code consumed at `at`; idempotent if already consumed. */
    markConsumed(id: string, at: Date): void;
}
