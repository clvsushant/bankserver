import type { AccountType } from "./account";

export interface AccountOpenedEvent {
    readonly type: "AccountOpened";
    readonly accountId: string;
    readonly accountNumber: string;
    readonly userId: string;
    readonly accountType: AccountType;
    readonly openedAt: Date;
}

export interface AccountFrozenEvent {
    readonly type: "AccountFrozen";
    readonly accountId: string;
    readonly accountNumber: string;
    readonly userId: string;
    readonly frozenAt: Date;
}

export interface AccountUnfrozenEvent {
    readonly type: "AccountUnfrozen";
    readonly accountId: string;
    readonly accountNumber: string;
    readonly userId: string;
    readonly unfrozenAt: Date;
}

export interface AccountClosedEvent {
    readonly type: "AccountClosed";
    readonly accountId: string;
    readonly accountNumber: string;
    readonly userId: string;
    readonly closedAt: Date;
}

export type AccountEvent =
    | AccountOpenedEvent
    | AccountFrozenEvent
    | AccountUnfrozenEvent
    | AccountClosedEvent;
