import type { Currency } from "../../../shared/money";

export interface CardSpentEvent {
    readonly type: "CardSpent";
    readonly cardId: string;
    readonly ownerUserId: string;
    readonly transferId: string;
    readonly amountMinor: number;
    readonly currency: Currency;
    readonly merchantName: string;
    readonly spentAt: Date;
}

export type CardEvent = CardSpentEvent;
