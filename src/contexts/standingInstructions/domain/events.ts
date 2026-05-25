import type { Currency } from "../../../shared/money";
import type { SiFrequency } from "./standingInstruction";

export interface StandingInstructionCreatedEvent {
    readonly type: "StandingInstructionCreated";
    readonly siId: string;
    readonly ownerUserId: string;
    readonly fromAccountId: string;
    readonly beneficiaryId: string;
    readonly amountMinor: number;
    readonly currency: Currency;
    readonly frequency: SiFrequency;
    readonly nextRunAt: Date;
    readonly createdAt: Date;
}

export interface StandingInstructionPausedEvent {
    readonly type: "StandingInstructionPaused";
    readonly siId: string;
    readonly ownerUserId: string;
    readonly pausedAt: Date;
}

export interface StandingInstructionResumedEvent {
    readonly type: "StandingInstructionResumed";
    readonly siId: string;
    readonly ownerUserId: string;
    readonly resumedAt: Date;
}

export interface StandingInstructionCancelledEvent {
    readonly type: "StandingInstructionCancelled";
    readonly siId: string;
    readonly ownerUserId: string;
    readonly cancelledAt: Date;
}

export type StandingInstructionLifecycleEvent =
    | StandingInstructionCreatedEvent
    | StandingInstructionPausedEvent
    | StandingInstructionResumedEvent
    | StandingInstructionCancelledEvent;
