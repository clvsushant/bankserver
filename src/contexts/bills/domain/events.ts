import type { Currency } from "../../../shared/money";

export interface BillPaidEvent {
    readonly type: "BillPaid";
    readonly transferId: string;
    readonly billerId: string;
    readonly fromAccountId: string;
    readonly fromUserId: string;
    readonly amountMinor: number;
    readonly currency: Currency;
    readonly customerRef?: string;
    readonly paidAt: Date;
}

export type BillEvent = BillPaidEvent;
