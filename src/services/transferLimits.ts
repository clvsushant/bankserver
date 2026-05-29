import type { Db } from "../db/client";
import { transfers } from "../db/schema";
import { and, eq, gte } from "drizzle-orm";

export type KycTier = "none" | "basic" | "full";

/** Default daily outbound limit: ₹1,00,000 (1 lakh) in paise. */
export const DEFAULT_DAILY_LIMIT_MINOR = 10_000_000;

/** Default monthly outbound limit: ₹10,00,000 in paise. */
export const DEFAULT_MONTHLY_LIMIT_MINOR = 100_000_000;

const TIER_MULTIPLIER: Record<KycTier, number> = {
    none: 0.25,
    basic: 1,
    full: 2,
};

export interface TransferLimitCheck {
    readonly allowed: boolean;
    readonly dailyUsedMinor: number;
    readonly dailyLimitMinor: number;
    readonly monthlyUsedMinor: number;
    readonly monthlyLimitMinor: number;
    readonly reason?: string;
}

function startOfDayMs(now: Date): number {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function startOfMonthMs(now: Date): number {
    const d = new Date(now);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

export function limitsForTier(tier: KycTier): {
    dailyLimitMinor: number;
    monthlyLimitMinor: number;
} {
    const mult = TIER_MULTIPLIER[tier] ?? 1;
    return {
        dailyLimitMinor: Math.floor(DEFAULT_DAILY_LIMIT_MINOR * mult),
        monthlyLimitMinor: Math.floor(DEFAULT_MONTHLY_LIMIT_MINOR * mult),
    };
}

/**
 * Sums posted outbound transfers from accounts owned by `userId` since
 * the start of the day / month. Tier-aware stub limits.
 */
export function checkAggregateLimits(
    db: Db,
    args: {
        userId: string;
        accountIds: string[];
        amountMinor: number;
        kycTier: KycTier;
        now: Date;
    }
): TransferLimitCheck {
    const { dailyLimitMinor, monthlyLimitMinor } = limitsForTier(args.kycTier);

    if (args.kycTier === "none") {
        return {
            allowed: false,
            dailyUsedMinor: 0,
            dailyLimitMinor,
            monthlyUsedMinor: 0,
            monthlyLimitMinor,
            reason: "KYC verification required before transfers",
        };
    }

    const dayStart = startOfDayMs(args.now);
    const monthStart = startOfMonthMs(args.now);

    let dailyUsedMinor = 0;
    let monthlyUsedMinor = 0;

    for (const accountId of args.accountIds) {
        const rows = db
            .select({ amountMinor: transfers.amountMinor, postedAt: transfers.postedAt })
            .from(transfers)
            .where(
                and(
                    eq(transfers.fromAccountId, accountId),
                    eq(transfers.status, "posted"),
                    gte(transfers.postedAt, new Date(monthStart))
                )
            )
            .all();
        for (const row of rows) {
            const postedMs = row.postedAt.getTime();
            monthlyUsedMinor += row.amountMinor;
            if (postedMs >= dayStart) dailyUsedMinor += row.amountMinor;
        }
    }

    const projectedDaily = dailyUsedMinor + args.amountMinor;
    const projectedMonthly = monthlyUsedMinor + args.amountMinor;

    if (projectedDaily > dailyLimitMinor) {
        return {
            allowed: false,
            dailyUsedMinor,
            dailyLimitMinor,
            monthlyUsedMinor,
            monthlyLimitMinor,
            reason: "Daily transfer limit exceeded",
        };
    }
    if (projectedMonthly > monthlyLimitMinor) {
        return {
            allowed: false,
            dailyUsedMinor,
            dailyLimitMinor,
            monthlyUsedMinor,
            monthlyLimitMinor,
            reason: "Monthly transfer limit exceeded",
        };
    }

    return {
        allowed: true,
        dailyUsedMinor,
        dailyLimitMinor,
        monthlyUsedMinor,
        monthlyLimitMinor,
    };
}

export function previewLimits(
    db: Db,
    args: { userId: string; accountIds: string[]; kycTier: KycTier; now: Date }
): Omit<TransferLimitCheck, "allowed" | "reason"> {
    const check = checkAggregateLimits(db, { ...args, amountMinor: 0 });
    return {
        dailyUsedMinor: check.dailyUsedMinor,
        dailyLimitMinor: check.dailyLimitMinor,
        monthlyUsedMinor: check.monthlyUsedMinor,
        monthlyLimitMinor: check.monthlyLimitMinor,
    };
}
