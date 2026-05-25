import type { UserRepo } from "./ports";
import { hashPassword, validateStrength, verifyPassword } from "./passwords";
import {
    InvalidCredentialsError,
    UnknownUserError,
    WeakPasswordError,
} from "../domain/errors";

/**
 * Phase 4 #1 — change a user's password.
 *
 *   - The caller must have a bound session (route-level requireSession).
 *   - Step-up via WebAuthn is enforced at the route layer.
 *   - The OLD password must verify; the NEW password must pass strength.
 */
export async function changePassword(
    deps: { userRepo: UserRepo },
    args: { userId: string; oldPassword: string; newPassword: string }
): Promise<void> {
    const user = deps.userRepo.findById(args.userId);
    if (!user) throw new UnknownUserError();

    const ok = await verifyPassword(args.oldPassword, user.passwordHash);
    if (!ok) throw new InvalidCredentialsError();

    const strength = validateStrength(args.newPassword);
    if (!strength.ok) throw new WeakPasswordError(strength.reason ?? "Weak password");

    if (args.oldPassword === args.newPassword) {
        throw new WeakPasswordError("New password must differ from current password");
    }

    const newHash = await hashPassword(args.newPassword);
    deps.userRepo.setPassword(user.id, newHash);
}
