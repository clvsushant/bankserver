import type { Currency } from "../../../shared/money";
import type { TransferKind } from "./transfer";

export interface MoneyMovedEvent {
    readonly type: "MoneyMoved";
    readonly transferId: string;
    readonly fromAccountId?: string;
    readonly toAccountId?: string;
    readonly amountMinor: number;
    readonly currency: Currency;
    readonly kind: TransferKind;
    readonly postedAt: Date;
}

export type PaymentEvent = MoneyMovedEvent;
