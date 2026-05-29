export type ExternalBeneficiaryStatus = "pending" | "active";
export type PreferredRail = "imps" | "neft" | "rtgs" | "upi";

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export interface ExternalBeneficiary {
    readonly id: string;
    readonly ownerUserId: string;
    readonly nickname: string;
    readonly accountNumber: string;
    readonly ifsc: string;
    readonly bankName: string;
    readonly beneficiaryName: string;
    readonly vpa?: string;
    readonly preferredRail?: PreferredRail;
    status: ExternalBeneficiaryStatus;
    activatedAt?: Date;
    readonly createdAt: Date;
    lastUsedAt?: Date;
}

export function isValidIfsc(v: string): boolean {
    return IFSC_RE.test(v);
}

export function createExternalBeneficiary(input: {
    id: string;
    ownerUserId: string;
    nickname: string;
    accountNumber: string;
    ifsc: string;
    bankName: string;
    beneficiaryName: string;
    vpa?: string;
    preferredRail?: PreferredRail;
    status?: ExternalBeneficiaryStatus;
    activatedAt?: Date;
    createdAt: Date;
}): ExternalBeneficiary {
    const ifsc = input.ifsc.toUpperCase();
    if (!isValidIfsc(ifsc)) throw new Error("Invalid IFSC");
    const accountNumber = input.accountNumber.trim();
    if (!/^\d{9,18}$/.test(accountNumber)) throw new Error("Invalid account number");
    const nickname = input.nickname.trim();
    if (!nickname) throw new Error("Nickname required");
    return {
        id: input.id,
        ownerUserId: input.ownerUserId,
        nickname,
        accountNumber,
        ifsc,
        bankName: input.bankName.trim(),
        beneficiaryName: input.beneficiaryName.trim(),
        vpa: input.vpa?.trim(),
        preferredRail: input.preferredRail,
        status: input.status ?? "pending",
        activatedAt: input.activatedAt,
        createdAt: input.createdAt,
    };
}
