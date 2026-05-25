import type { Clock } from "../../../shared/clock";
import type { UserRepo } from "./ports";
import { isLocked, type User } from "../domain/user";
import { AccountLockedError, InvalidCredentialsError } from "../domain/errors";
import { verifyPassword } from "./passwords";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export interface LoginPasswordResult {
    user: User;
    /**
     * "enroll": user has no passkey yet — UI must run /webauthn/registration/*
     * "auth":   user already has a passkey — UI must run /identity/login/passkey/*
     */
    nextStep: "enroll" | "auth";
}

/**
 * Verifies username + password. On success returns the next step the UI
 * needs to take. On failure increments the failed-attempt counter and may
 * lock the account temporarily (15 min after 5 misses).
 *
 * IMPORTANT: callers must NOT bind the user to the encrypted session here;
 * binding only happens AFTER the passkey step succeeds.
 */
export async function loginWithPassword(
    deps: { userRepo: UserRepo; clock: Clock },
    input: { username: string; password: string }
): Promise<LoginPasswordResult> {
    const user = deps.userRepo.findByUsername(input.username);
    // Always run a bcrypt comparison even when the user is unknown so we
    // don't leak existence via timing. The dummy hash never matches.
    const dummyHash = "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96BR6HIm0YbV0u6FbwvYmHjHj.";
    if (!user) {
        await verifyPassword(input.password, dummyHash);
        throw new InvalidCredentialsError();
    }

    const now = deps.clock.now();
    if (isLocked(user, now)) throw new AccountLockedError();

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
        const nextCount = user.failedAttempts + 1;
        const lockedUntil =
            nextCount >= LOCKOUT_THRESHOLD ? new Date(now.getTime() + LOCKOUT_WINDOW_MS) : undefined;
        deps.userRepo.recordFailedAttempt(user.id, lockedUntil);
        throw new InvalidCredentialsError();
    }

    deps.userRepo.resetFailedAttempts(user.id);
    return {
        user,
        nextStep: user.passkeyEnrolled ? "auth" : "enroll",
    };
}
