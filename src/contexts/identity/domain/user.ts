/**
 * Identity domain — pure types (no DB, no Express).
 */

export type Role = "customer" | "admin";
export type AccountStatus = "Active" | "Locked";
export type KycTier = "none" | "basic" | "full";

export interface User {
    readonly id: string;
    readonly username: string;
    readonly email: string;
    readonly passwordHash: string;
    readonly role: Role;
    readonly accountStatus: AccountStatus;
    readonly failedAttempts: number;
    readonly lockedUntil?: Date;
    readonly passkeyEnrolled: boolean;
    readonly kycTier: KycTier;
    readonly mobile?: string;
    readonly createdAt: Date;
}

export function createUser(input: {
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    role?: Role;
    passkeyEnrolled?: boolean;
    createdAt: Date;
}): User {
    if (input.username.length < 1 || input.username.length > 64) {
        throw new Error("Username must be 1-64 chars");
    }
    return {
        id: input.id,
        username: input.username,
        email: input.email,
        passwordHash: input.passwordHash,
        role: input.role ?? "customer",
        accountStatus: "Active",
        failedAttempts: 0,
        passkeyEnrolled: input.passkeyEnrolled ?? false,
        kycTier: "none",
        createdAt: input.createdAt,
    };
}

/**
 * Encodes the lockout decision: returns true if the account is currently
 * locked (admin lock OR temporary lockout window not yet elapsed).
 */
export function isLocked(user: User, now: Date): boolean {
    if (user.accountStatus === "Locked") return true;
    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) return true;
    return false;
}
