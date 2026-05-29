/** Demo FD rate card — annual rate in basis points by tenure bucket. */
export const FD_RATE_BPS: ReadonlyArray<{ minMonths: number; maxMonths: number; rateBps: number }> =
    [
        { minMonths: 7, maxMonths: 12, rateBps: 650 },
        { minMonths: 13, maxMonths: 24, rateBps: 700 },
        { minMonths: 25, maxMonths: 36, rateBps: 750 },
        { minMonths: 37, maxMonths: 60, rateBps: 775 },
        { minMonths: 61, maxMonths: 120, rateBps: 800 },
    ];

export const FD_MIN_PRINCIPAL_MINOR = 1_000_000; // ₹10,000
export const FD_MIN_TENURE_MONTHS = 7;
export const FD_MAX_TENURE_MONTHS = 120;
export const FD_PREMATURE_PENALTY_BPS = 100; // 1% penalty on accrued interest

export type FixedDepositStatus = "active" | "matured" | "premature_closed";

export interface FixedDeposit {
    readonly id: string;
    readonly accountId: string;
    readonly userId: string;
    readonly payoutAccountId: string;
    readonly principalMinor: number;
    readonly tenureMonths: number;
    readonly interestRateBps: number;
    readonly openedAt: Date;
    readonly maturityAt: Date;
    readonly autoRenew: boolean;
    status: FixedDepositStatus;
    closedAt?: Date;
    interestPaidMinor: number;
}

export function rateBpsForTenure(months: number): number {
    const tier = FD_RATE_BPS.find((t) => months >= t.minMonths && months <= t.maxMonths);
    if (!tier) throw new Error("Unsupported FD tenure");
    return tier.rateBps;
}

/** Simple interest accrual: principal * rate * months / (12 * 10000 bps). */
export function accruedInterestMinor(fd: FixedDeposit, asOf: Date): number {
    const ms = asOf.getTime() - fd.openedAt.getTime();
    const monthsElapsed = Math.max(0, Math.floor(ms / (30 * 24 * 60 * 60 * 1000)));
    const months = Math.min(monthsElapsed, fd.tenureMonths);
    return Math.floor((fd.principalMinor * fd.interestRateBps * months) / (12 * 10_000));
}

export function prematureInterestMinor(fd: FixedDeposit, asOf: Date): number {
    const gross = accruedInterestMinor(fd, asOf);
    const penalty = Math.floor((gross * FD_PREMATURE_PENALTY_BPS) / 10_000);
    return Math.max(0, gross - penalty);
}

export function maturityInterestMinor(fd: FixedDeposit): number {
    return Math.floor((fd.principalMinor * fd.interestRateBps * fd.tenureMonths) / (12 * 10_000));
}

export function openFixedDeposit(input: {
    id: string;
    accountId: string;
    userId: string;
    payoutAccountId: string;
    principalMinor: number;
    tenureMonths: number;
    autoRenew: boolean;
    openedAt: Date;
}): FixedDeposit {
    if (input.principalMinor < FD_MIN_PRINCIPAL_MINOR) throw new Error("FD minimum principal not met");
    if (
        input.tenureMonths < FD_MIN_TENURE_MONTHS ||
        input.tenureMonths > FD_MAX_TENURE_MONTHS
    )
        throw new Error("Invalid FD tenure");
    const maturityAt = new Date(input.openedAt);
    maturityAt.setMonth(maturityAt.getMonth() + input.tenureMonths);
    return {
        id: input.id,
        accountId: input.accountId,
        userId: input.userId,
        payoutAccountId: input.payoutAccountId,
        principalMinor: input.principalMinor,
        tenureMonths: input.tenureMonths,
        interestRateBps: rateBpsForTenure(input.tenureMonths),
        openedAt: input.openedAt,
        maturityAt,
        autoRenew: input.autoRenew,
        status: "active",
        interestPaidMinor: 0,
    };
}

export function markMatured(fd: FixedDeposit, at: Date): FixedDeposit {
    if (fd.status !== "active") throw new Error("FD not active");
    return { ...fd, status: "matured", closedAt: at };
}

export function markPrematureClosed(fd: FixedDeposit, interestPaidMinor: number, at: Date): FixedDeposit {
    if (fd.status !== "active") throw new Error("FD not active");
    return { ...fd, status: "premature_closed", closedAt: at, interestPaidMinor };
}
