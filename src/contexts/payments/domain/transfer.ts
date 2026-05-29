import type { Currency } from "../../../shared/money";

export type TransferKind = "transfer" | "faucet" | "reversal";
export type TransferStatus = "pending" | "posted" | "failed";
export type TransferRail = "internal" | "imps" | "neft" | "rtgs" | "upi";
export type TransferCategory = "p2p" | "self" | "faucet" | "bill" | "card";

export interface Transfer {
    readonly id: string;
    readonly idempotencyKey?: string;
    readonly fromAccountId?: string;
    readonly toAccountId?: string;
    readonly amountMinor: number;
    readonly currency: Currency;
    readonly memo?: string;
    readonly kind: TransferKind;
    readonly status: TransferStatus;
    readonly rail: TransferRail;
    readonly utr?: string;
    readonly failureReason?: string;
    readonly postedAt: Date;
    readonly referenceNumber?: string;
    readonly feeMinor: number;
    readonly category?: TransferCategory;
    readonly fromAccountNumber?: string;
    readonly toAccountNumber?: string;
    readonly fromUsername?: string;
    readonly toUsername?: string;
    readonly description?: string;
    readonly billerId?: string;
    readonly cardId?: string;
}

export interface LedgerEntry {
    readonly id: string;
    readonly accountId: string;
    readonly transferId: string;
    readonly kind: "debit" | "credit";
    readonly amountMinor: number;
    readonly runningBalanceMinor: number;
    readonly postedAt: Date;
}

export function generateUtr(now: Date): string {
    const ts = now.getTime().toString(36).toUpperCase();
    const rand = Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0");
    return `UTR${ts}${rand}`;
}
