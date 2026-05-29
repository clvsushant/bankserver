/**
 * Beneficiary — a saved payee. Keyed by (ownerUserId, accountNumber)
 * so an owner can't accidentally save the same target twice. The
 * username snapshot is for display only; canonical identity is the
 * account number.
 */

export type BeneficiaryStatus = "pending" | "active";

export const BENEFICIARY_COOLING_MS = 24 * 60 * 60 * 1000;

export interface Beneficiary {
    readonly id: string;
    readonly ownerUserId: string;
    readonly nickname: string;
    readonly accountNumber: string;
    readonly beneficiaryUsername?: string;
    status: BeneficiaryStatus;
    activatedAt?: Date;
    readonly createdAt: Date;
    lastUsedAt?: Date;
}

const ACCOUNT_NUMBER_RE = /^SBE-\d{10}$/;

export function isValidAccountNumber(v: unknown): v is string {
    return typeof v === "string" && ACCOUNT_NUMBER_RE.test(v);
}

export function isTransferAllowed(b: Beneficiary, now: Date): boolean {
    if (b.status === "active") return true;
    if (b.activatedAt && now.getTime() >= b.activatedAt.getTime()) return true;
    return false;
}

export function createBeneficiary(input: {
    id: string;
    ownerUserId: string;
    nickname: string;
    accountNumber: string;
    beneficiaryUsername?: string;
    status?: BeneficiaryStatus;
    activatedAt?: Date;
    createdAt: Date;
}): Beneficiary {
    const nickname = input.nickname.trim();
    if (!nickname) throw new Error("Nickname required");
    if (nickname.length > 64) throw new Error("Nickname too long");
    if (!isValidAccountNumber(input.accountNumber))
        throw new Error("Invalid account number");
    return {
        id: input.id,
        ownerUserId: input.ownerUserId,
        nickname,
        accountNumber: input.accountNumber,
        beneficiaryUsername: input.beneficiaryUsername,
        status: input.status ?? "pending",
        activatedAt: input.activatedAt,
        createdAt: input.createdAt,
    };
}

export function activateBeneficiary(b: Beneficiary, at: Date): Beneficiary {
    return { ...b, status: "active", activatedAt: b.activatedAt ?? at };
}

export function renameBeneficiaryNickname(b: Beneficiary, nickname: string): Beneficiary {
    const trimmed = nickname.trim();
    if (!trimmed) throw new Error("Nickname required");
    if (trimmed.length > 64) throw new Error("Nickname too long");
    return { ...b, nickname: trimmed };
}
