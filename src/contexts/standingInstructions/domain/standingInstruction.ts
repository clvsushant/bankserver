import type { Currency } from "../../../shared/money";

export type SiFrequency = "daily" | "weekly" | "monthly";
export type SiStatus = "active" | "paused" | "cancelled";

export interface StandingInstruction {
    readonly id: string;
    readonly ownerUserId: string;
    readonly fromAccountId: string;
    readonly beneficiaryId: string;
    readonly amountMinor: number;
    readonly currency: Currency;
    readonly frequency: SiFrequency;
    nextRunAt: Date;
    lastRunAt?: Date;
    status: SiStatus;
    readonly description?: string;
    readonly createdAt: Date;
}

export function createInstruction(input: {
    id: string;
    ownerUserId: string;
    fromAccountId: string;
    beneficiaryId: string;
    amountMinor: number;
    currency: Currency;
    frequency: SiFrequency;
    description?: string;
    startAt: Date;
    createdAt: Date;
}): StandingInstruction {
    if (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor)) {
        throw new Error("amountMinor must be a positive integer");
    }
    return {
        id: input.id,
        ownerUserId: input.ownerUserId,
        fromAccountId: input.fromAccountId,
        beneficiaryId: input.beneficiaryId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        frequency: input.frequency,
        nextRunAt: input.startAt,
        status: "active",
        description: input.description,
        createdAt: input.createdAt,
    };
}

/**
 * Returns the run timestamp following `from` for the given frequency.
 * Pure / deterministic — used both at creation time (to set the first
 * nextRunAt) and after a run to advance.
 */
export function advanceRun(from: Date, frequency: SiFrequency): Date {
    const d = new Date(from.getTime());
    switch (frequency) {
        case "daily":
            d.setUTCDate(d.getUTCDate() + 1);
            return d;
        case "weekly":
            d.setUTCDate(d.getUTCDate() + 7);
            return d;
        case "monthly":
            d.setUTCMonth(d.getUTCMonth() + 1);
            return d;
    }
}
