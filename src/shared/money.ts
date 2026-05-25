/**
 * Money value object. Stores **minor units** (paise, cents, ...) as a
 * regular `number` for SQLite-friendliness — JS `number` is safe up to
 * 2^53, which covers ~9e13 paise (~9e11 INR), more than enough for a
 * sample. Real banking systems would use bigint or a decimal library.
 *
 * The point of this VO is to make sure we never accidentally do
 * `account.balance + 1.5` (floats) and to keep "amount" arithmetic
 * exclusively in domain code.
 */

export type Currency = "INR";

export interface Money {
    readonly minor: number;
    readonly currency: Currency;
}

export function money(minor: number, currency: Currency = "INR"): Money {
    if (!Number.isInteger(minor)) throw new Error("Money.minor must be an integer");
    if (minor < 0) throw new Error("Money.minor must be >= 0");
    return Object.freeze({ minor, currency });
}

export function add(a: Money, b: Money): Money {
    if (a.currency !== b.currency) throw new Error("Currency mismatch");
    return money(a.minor + b.minor, a.currency);
}

export function sub(a: Money, b: Money): Money {
    if (a.currency !== b.currency) throw new Error("Currency mismatch");
    if (b.minor > a.minor) throw new Error("Money.sub would underflow");
    return money(a.minor - b.minor, a.currency);
}

export function gte(a: Money, b: Money): boolean {
    if (a.currency !== b.currency) throw new Error("Currency mismatch");
    return a.minor >= b.minor;
}

export function isZero(a: Money): boolean {
    return a.minor === 0;
}

export function format(a: Money): string {
    const major = (a.minor / 100).toFixed(2);
    return `${a.currency} ${major}`;
}

/** Formats a raw minor-unit number as a friendly INR string for log lines. */
export function inrFmtMinor(minor: number): string {
    const major = (minor / 100).toFixed(2);
    return `INR ${major}`;
}
