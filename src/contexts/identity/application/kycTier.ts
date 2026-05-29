import type { UserRepo } from "./ports";

export type KycTier = "none" | "basic" | "full";

export function setKycTier(deps: { users: UserRepo }, userId: string, tier: KycTier): void {
    deps.users.setKycTier(userId, tier);
}

export function getKycTier(deps: { users: UserRepo }, userId: string): KycTier {
    const user = deps.users.findById(userId);
    return user?.kycTier ?? "none";
}
