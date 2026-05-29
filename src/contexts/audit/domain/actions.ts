/**
 * Canonical action-name registry. Every audit row's `action` field is one
 * of these strings; new mutating endpoints or domain events MUST add their
 * action here so dashboards and filters stay typed.
 *
 * Naming: `<subject>.<verb>` lowercase (auth, kyc, account, etc.) so the
 * filter UI can group by prefix.
 */

export const AuditActions = {
    // --- auth ---
    AuthLoginSuccess: "auth.login.success",
    AuthLoginFailure: "auth.login.failure",
    AuthLogout: "auth.logout",
    AuthSignup: "auth.signup",
    AuthPasswordChanged: "auth.password.changed",
    AuthPasskeyEnrolled: "auth.passkey.enrolled",
    AuthPasskeyEnrolledAdditional: "auth.passkey.enrolled.additional",
    AuthPasskeyAuthenticated: "auth.passkey.authenticated",
    AuthPasskeyRevoked: "auth.passkey.revoked",
    AuthPasskeyLabeled: "auth.passkey.labeled",
    AuthSessionsWiped: "auth.sessions.wiped",
    AuthRecoveryConsumedSuccess: "auth.recovery.consumed.success",
    AuthRecoveryConsumedFailure: "auth.recovery.consumed.failure",
    AuthOtpRequested: "auth.otp.requested",
    AuthOtpVerified: "auth.otp.verified",
    AuthOtpFailed: "auth.otp.failed",
    IdentityContactChanged: "identity.contact.changed",

    // --- money / payments ---
    TransferExecuted: "transfer.executed",
    TransferRailExecuted: "transfer.rail.executed",
    TransferSettled: "transfer.settled",
    DisputeFiled: "dispute.filed",
    DisputeDecided: "dispute.decided",
    FaucetCredited: "faucet.credited",
    BillPaid: "bill.paid",
    StandingInstructionRan: "si.ran",
    StandingInstructionCreated: "si.created",
    StandingInstructionPaused: "si.paused",
    StandingInstructionResumed: "si.resumed",
    StandingInstructionCancelled: "si.cancelled",

    // --- accounts ---
    AccountOpened: "account.opened",
    AccountFrozen: "account.frozen",
    AccountUnfrozen: "account.unfrozen",
    AccountClosed: "account.closed",
    FixedDepositOpened: "account.fd.opened",
    FixedDepositPrematureClosed: "account.fd.premature_closed",
    FixedDepositMatured: "account.fd.matured",

    // --- kyc ---
    KycSubmitted: "kyc.submitted",
    KycApproved: "kyc.approved",
    KycRejected: "kyc.rejected",

    // --- beneficiaries ---
    BeneficiaryAdded: "beneficiary.added",
    BeneficiaryRenamed: "beneficiary.renamed",
    BeneficiaryRemoved: "beneficiary.removed",

    // --- cards ---
    CardIssued: "card.issued",
    CardFrozen: "card.frozen",
    CardCancelled: "card.cancelled",
    CardLimitsUpdated: "card.limits.updated",
    CardSpent: "card.spent",

    // --- admin reads (privileged) ---
    AdminKycListed: "admin.kyc.listed",
    AdminKycViewed: "admin.kyc.viewed",
    AdminAccountsListed: "admin.accounts.listed",
    AdminTransactionsListed: "admin.transactions.listed",
    AdminUsersListed: "admin.users.listed",
    AdminAuditListed: "admin.audit.listed",
    AdminAuditViewed: "admin.audit.viewed",
    AdminAuditExported: "admin.audit.exported",
    AdminAuditVerified: "admin.audit.verified",

    // --- admin writes ---
    AdminUserLocked: "admin.user.locked",
    AdminUserUnlocked: "admin.user.unlocked",
    AdminUserRoleChanged: "admin.user.role.changed",
    AdminUserPasswordReset: "admin.user.password.reset",
    AdminFaucetIssued: "admin.faucet.issued",
    AdminStandingInstructionsRan: "admin.si.ran",
    AdminRecoveryCodeIssued: "admin.recovery.code.issued",
    AdminPendingActionCreated: "admin.pending.created",
    AdminPendingActionApproved: "admin.pending.approved",
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];

export const AUDIT_ACTION_VALUES: readonly AuditAction[] = Object.freeze(
    Object.values(AuditActions) as AuditAction[]
);

export type AuditCategory =
    | "auth"
    | "money"
    | "kyc"
    | "account"
    | "beneficiary"
    | "bill"
    | "si"
    | "card"
    | "admin.read"
    | "admin.write"
    | "system";

/**
 * Category derivation from action name. Keeps the filter/index uniform
 * without forcing every call site to specify both.
 */
export function categoryOf(action: AuditAction): AuditCategory {
    if (action.startsWith("auth.")) return "auth";
    if (action.startsWith("kyc.")) return "kyc";
    if (action.startsWith("account.")) return "account";
    if (action.startsWith("beneficiary.")) return "beneficiary";
    if (action.startsWith("bill.")) return "bill";
    if (action.startsWith("si.")) return "si";
    if (action.startsWith("card.")) return "card";
    if (
        action.startsWith("transfer.") ||
        action.startsWith("faucet.") ||
        action.startsWith("dispute.")
    )
        return "money";
    if (action.startsWith("admin.")) {
        // Reads end in .listed / .viewed / .exported / .verified.
        if (
            action.endsWith(".listed") ||
            action.endsWith(".viewed") ||
            action.endsWith(".exported") ||
            action.endsWith(".verified")
        ) {
            return "admin.read";
        }
        return "admin.write";
    }
    return "system";
}
