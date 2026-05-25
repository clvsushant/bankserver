/**
 * Beneficiary — a saved payee. Keyed by (ownerUserId, accountNumber)
 * so an owner can't accidentally save the same target twice. The
 * username snapshot is for display only; canonical identity is the
 * account number.
 */

export interface Beneficiary {
    readonly id: string;
    readonly ownerUserId: string;
    readonly nickname: string;
    readonly accountNumber: string;
    readonly beneficiaryUsername?: string;
    readonly createdAt: Date;
    lastUsedAt?: Date;
}

const ACCOUNT_NUMBER_RE = /^SBE-\d{10}$/;

export function isValidAccountNumber(v: unknown): v is string {
    return typeof v === "string" && ACCOUNT_NUMBER_RE.test(v);
}

export function createBeneficiary(input: {
    id: string;
    ownerUserId: string;
    nickname: string;
    accountNumber: string;
    beneficiaryUsername?: string;
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
        createdAt: input.createdAt,
    };
}
