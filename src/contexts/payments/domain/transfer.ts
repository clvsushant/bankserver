import type { Currency } from "../../../shared/money";

export type TransferKind = "transfer" | "faucet";
export type TransferStatus = "posted" | "failed";
export type TransferCategory = "p2p" | "self" | "faucet" | "bill";

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
    readonly postedAt: Date;
    /** Phase 3 — rich summary fields. Null on pre-migration rows. */
    readonly referenceNumber?: string;
    readonly feeMinor: number;
    readonly category?: TransferCategory;
    readonly fromAccountNumber?: string;
    readonly toAccountNumber?: string;
    readonly fromUsername?: string;
    readonly toUsername?: string;
    readonly description?: string;
    /** Phase 4 #6 — links a bill payment back to its biller row. */
    readonly billerId?: string;
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
