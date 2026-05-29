import type { AccountRepo } from "../../accounts/application/ports";
import type { KycRepo } from "./ports";
import { KycBankingAccessDeniedError } from "../domain/errors";

export interface BankingAccess {
    readonly kycApproved: boolean;
    readonly activeAccountCount: number;
    readonly allowed: boolean;
}

export function getBankingAccess(
    deps: { kyc: KycRepo; accounts: AccountRepo },
    userId: string
): BankingAccess {
    const apps = deps.kyc.listByUserId(userId);
    const kycApproved = apps.some((a) => a.status === "Approved");
    const activeAccounts = deps.accounts.listByUserId(userId).filter((a) => a.status === "Active");
    const activeAccountCount = activeAccounts.length;
    return {
        kycApproved,
        activeAccountCount,
        allowed: kycApproved && activeAccountCount > 0,
    };
}

export function assertBankingAccess(
    deps: { kyc: KycRepo; accounts: AccountRepo },
    userId: string
): void {
    const access = getBankingAccess(deps, userId);
    if (access.allowed) return;

    if (!access.kycApproved) {
        throw new KycBankingAccessDeniedError(
            "KYC must be approved before using banking features"
        );
    }
    throw new KycBankingAccessDeniedError(
        "An active account is required before using banking features"
    );
}
