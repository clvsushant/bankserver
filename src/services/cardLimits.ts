import type { Db } from "../db/client";
import { transfers } from "../db/schema";
import { and, eq, gte } from "drizzle-orm";
import {
    limitsForTier,
    type KycTier,
} from "./transferLimits";

/** Default customer card limits on issue (paise). */
export const DEFAULT_CARD_DAILY_LIMIT_MINOR = 2_500_000;
export const DEFAULT_CARD_MONTHLY_LIMIT_MINOR = 25_000_000;
export const DEFAULT_CARD_PER_TXN_LIMIT_MINOR = 1_000_000;

/** Bank per-transaction ceiling base (₹10L), scaled by KYC tier. */
export const PER_TXN_BANK_MAX_BASE = 1_000_000_00;

export const CARD_MERCHANT_BILLER_NAME = "Card Merchant Settlement";

export interface CardLimits {
    readonly perTxnLimitMinor: number;
    readonly dailyLimitMinor: number;
    readonly monthlyLimitMinor: number;
}

export interface CardLimitCheck {
    readonly allowed: boolean;
    readonly dailyUsedMinor: number;
    readonly dailyLimitMinor: number;
    readonly monthlyUsedMinor: number;
    readonly monthlyLimitMinor: number;
    readonly perTxnLimitMinor: number;
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

const TIER_MULTIPLIER: Record<KycTier, number> = {
    none: 0.25,
    basic: 1,
    full: 2,
};

export function bankMaxForTier(tier: KycTier): CardLimits {
    const mult = TIER_MULTIPLIER[tier] ?? 1;
    const tierLimits = limitsForTier(tier);
    return {
        dailyLimitMinor: tierLimits.dailyLimitMinor,
        monthlyLimitMinor: tierLimits.monthlyLimitMinor,
        perTxnLimitMinor: Math.floor(PER_TXN_BANK_MAX_BASE * mult),
    };
}

export function defaultLimitsForTier(tier: KycTier): CardLimits {
    const max = bankMaxForTier(tier);
    return {
        dailyLimitMinor: Math.min(DEFAULT_CARD_DAILY_LIMIT_MINOR, max.dailyLimitMinor),
        monthlyLimitMinor: Math.min(DEFAULT_CARD_MONTHLY_LIMIT_MINOR, max.monthlyLimitMinor),
        perTxnLimitMinor: Math.min(DEFAULT_CARD_PER_TXN_LIMIT_MINOR, max.perTxnLimitMinor),
    };
}

export function validateLimitsAgainstBankMax(
    limits: CardLimits,
    tier: KycTier
): { ok: true } | { ok: false; field: keyof CardLimits } {
    const max = bankMaxForTier(tier);
    if (limits.perTxnLimitMinor > max.perTxnLimitMinor) return { ok: false, field: "perTxnLimitMinor" };
    if (limits.dailyLimitMinor > max.dailyLimitMinor) return { ok: false, field: "dailyLimitMinor" };
    if (limits.monthlyLimitMinor > max.monthlyLimitMinor) return { ok: false, field: "monthlyLimitMinor" };
    if (limits.dailyLimitMinor > limits.monthlyLimitMinor) return { ok: false, field: "dailyLimitMinor" };
    if (limits.perTxnLimitMinor > limits.dailyLimitMinor) return { ok: false, field: "perTxnLimitMinor" };
    return { ok: true };
}

export function checkCardLimits(
    db: Db,
    args: {
        cardId: string;
        amountMinor: number;
        limits: CardLimits;
        now: Date;
    }
): CardLimitCheck {
    const { limits } = args;

    if (args.amountMinor > limits.perTxnLimitMinor) {
        return {
            allowed: false,
            dailyUsedMinor: 0,
            dailyLimitMinor: limits.dailyLimitMinor,
            monthlyUsedMinor: 0,
            monthlyLimitMinor: limits.monthlyLimitMinor,
            perTxnLimitMinor: limits.perTxnLimitMinor,
            reason: "Per-transaction card limit exceeded",
        };
    }

    const dayStart = startOfDayMs(args.now);
    const monthStart = startOfMonthMs(args.now);

    let dailyUsedMinor = 0;
    let monthlyUsedMinor = 0;

    const rows = db
        .select({ amountMinor: transfers.amountMinor, postedAt: transfers.postedAt })
        .from(transfers)
        .where(
            and(
                eq(transfers.cardId, args.cardId),
                eq(transfers.category, "card"),
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

    const projectedDaily = dailyUsedMinor + args.amountMinor;
    const projectedMonthly = monthlyUsedMinor + args.amountMinor;

    if (projectedDaily > limits.dailyLimitMinor) {
        return {
            allowed: false,
            dailyUsedMinor,
            dailyLimitMinor: limits.dailyLimitMinor,
            monthlyUsedMinor,
            monthlyLimitMinor: limits.monthlyLimitMinor,
            perTxnLimitMinor: limits.perTxnLimitMinor,
            reason: "Daily card limit exceeded",
        };
    }
    if (projectedMonthly > limits.monthlyLimitMinor) {
        return {
            allowed: false,
            dailyUsedMinor,
            dailyLimitMinor: limits.dailyLimitMinor,
            monthlyUsedMinor,
            monthlyLimitMinor: limits.monthlyLimitMinor,
            perTxnLimitMinor: limits.perTxnLimitMinor,
            reason: "Monthly card limit exceeded",
        };
    }

    return {
        allowed: true,
        dailyUsedMinor,
        dailyLimitMinor: limits.dailyLimitMinor,
        monthlyUsedMinor,
        monthlyLimitMinor: limits.monthlyLimitMinor,
        perTxnLimitMinor: limits.perTxnLimitMinor,
    };
}

export function previewCardLimits(
    db: Db,
    args: { cardId: string; limits: CardLimits; now: Date }
): Omit<CardLimitCheck, "allowed" | "reason"> {
    const check = checkCardLimits(db, { ...args, amountMinor: 0 });
    return {
        dailyUsedMinor: check.dailyUsedMinor,
        dailyLimitMinor: check.dailyLimitMinor,
        monthlyUsedMinor: check.monthlyUsedMinor,
        monthlyLimitMinor: check.monthlyLimitMinor,
        perTxnLimitMinor: check.perTxnLimitMinor,
    };
}
