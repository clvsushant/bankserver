import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import { createUser } from "../domain/user";
import type { Role, User } from "../domain/user";
import type { UserRepo } from "./ports";
import {
    InvalidEmailError,
    UsernameTakenError,
    WeakPasswordError,
} from "../domain/errors";
import { hashPassword, validateStrength } from "./passwords";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Customer signup. Username + email + password are all required. Throws
 * {@link UsernameTakenError} if the username is already used,
 * {@link InvalidEmailError} for malformed emails, and
 * {@link WeakPasswordError} for weak passwords. The password is bcrypt-hashed
 * before persisting; the resulting user has no passkey yet — that gets
 * registered on first login.
 */
export async function signupUser(
    deps: { userRepo: UserRepo; ids: IdGenerator; clock: Clock },
    input: { username: string; email: string; password: string; role?: Role }
): Promise<User> {
    if (!USERNAME_RE.test(input.username)) {
        throw new Error("Username must be 3-32 chars, alphanumeric / _ / -");
    }
    if (!EMAIL_RE.test(input.email) || input.email.length > 254) {
        throw new InvalidEmailError();
    }
    const strength = validateStrength(input.password);
    if (!strength.ok) throw new WeakPasswordError(strength.reason ?? "Weak password");

    if (deps.userRepo.findByUsername(input.username)) throw new UsernameTakenError();

    const passwordHash = await hashPassword(input.password);
    const user = createUser({
        id: deps.ids.uuid(),
        username: input.username,
        email: input.email,
        passwordHash,
        role: input.role ?? "customer",
        passkeyEnrolled: false,
        createdAt: deps.clock.now(),
    });
    deps.userRepo.insert(user);
    return user;
}

/**
 * Dev-only shortcut: pre-creates a user with a known password and
 * passkey-enrolled flag set so they can be used by /dev/login-as without
 * triggering the full 2FA flow. Calling this in production is a footgun.
 */
export async function devSeedUser(
    deps: { userRepo: UserRepo; ids: IdGenerator; clock: Clock },
    input: { username: string; password?: string; role: Role }
): Promise<User> {
    const existing = deps.userRepo.findByUsername(input.username);
    if (existing) return existing;
    const passwordHash = input.password
        ? await hashPassword(input.password)
        : ""; // sentinel — no password login possible
    const user = createUser({
        id: deps.ids.uuid(),
        username: input.username,
        email: `${input.username}@dev.local`,
        passwordHash,
        role: input.role,
        passkeyEnrolled: true, // dev shortcut bypasses passkey enrollment
        createdAt: deps.clock.now(),
    });
    deps.userRepo.insert(user);
    return user;
}

/**
 * Sync test/dev helper. Creates a user with sentinel password and
 * passkey-enrolled flag set. Callers that want a real password should use
 * {@link signupUser} (production) or {@link devSeedUser} (async).
 *
 * Idempotent: returns the existing user if username is already used.
 */
export function findOrCreateUser(
    deps: { userRepo: UserRepo; ids: IdGenerator; clock: Clock },
    username: string,
    role: Role = "customer"
): User {
    const existing = deps.userRepo.findByUsername(username);
    if (existing) return existing;
    const user = createUser({
        id: deps.ids.uuid(),
        username,
        email: `${username}@dev.local`,
        passwordHash: "",
        role,
        passkeyEnrolled: true,
        createdAt: deps.clock.now(),
    });
    deps.userRepo.insert(user);
    return user;
}

/** Sync test/dev helper. Throws {@link UsernameTakenError} on duplicate. */
export function registerUser(
    deps: { userRepo: UserRepo; ids: IdGenerator; clock: Clock },
    username: string,
    role: Role = "customer"
): User {
    if (deps.userRepo.findByUsername(username)) throw new UsernameTakenError();
    const user = createUser({
        id: deps.ids.uuid(),
        username,
        email: `${username}@dev.local`,
        passwordHash: "",
        role,
        passkeyEnrolled: true,
        createdAt: deps.clock.now(),
    });
    deps.userRepo.insert(user);
    return user;
}
