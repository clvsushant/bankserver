import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import type { Currency } from "../../../shared/money";
import type { AccountRepo } from "../../accounts/application/ports";
import type { BeneficiaryRepo } from "../../beneficiaries/application/ports";
import {
    advanceRun,
    createInstruction,
    type SiFrequency,
    type StandingInstruction,
} from "../domain/standingInstruction";
import {
    StandingInstructionInvalidStateError,
    StandingInstructionNotFoundError,
} from "../domain/errors";
import type {
    StandingInstructionCancelledEvent,
    StandingInstructionCreatedEvent,
    StandingInstructionPausedEvent,
    StandingInstructionResumedEvent,
} from "../domain/events";
import { AccountNotFoundError } from "../../accounts/domain/errors";
import { BeneficiaryNotFoundError } from "../../beneficiaries/domain/errors";
import type { StandingInstructionRepo } from "./ports";
import type { KycRepo } from "../../kyc/application/ports";
import { assertBankingAccess } from "../../kyc/application/bankingAccess";

export interface CreateInstructionInput {
    ownerUserId: string;
    fromAccountId: string;
    beneficiaryId: string;
    amountMinor: number;
    currency: Currency;
    frequency: SiFrequency;
    description?: string;
    /** Optional first-run timestamp; defaults to "now + 1 frequency tick". */
    startAt?: Date;
    endAt?: Date;
}

export function createStandingInstruction(
    deps: {
        repo: StandingInstructionRepo;
        accounts: AccountRepo;
        beneficiaries: BeneficiaryRepo;
        kyc: KycRepo;
        ids: IdGenerator;
        clock: Clock;
        bus?: EventBus;
    },
    input: CreateInstructionInput
): StandingInstruction {
    assertBankingAccess(
        { kyc: deps.kyc, accounts: deps.accounts },
        input.ownerUserId
    );

    const from = deps.accounts.findById(input.fromAccountId);
    if (!from) throw new AccountNotFoundError();
    if (from.userId !== input.ownerUserId) throw new AccountNotFoundError();

    const beneficiary = deps.beneficiaries.findById(input.beneficiaryId);
    if (!beneficiary || beneficiary.ownerUserId !== input.ownerUserId)
        throw new BeneficiaryNotFoundError();

    const now = deps.clock.now();
    const startAt = input.startAt ?? advanceRun(now, input.frequency);

    const si = createInstruction({
        id: deps.ids.uuid(),
        ownerUserId: input.ownerUserId,
        fromAccountId: input.fromAccountId,
        beneficiaryId: input.beneficiaryId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        frequency: input.frequency,
        description: input.description,
        startAt,
        endAt: input.endAt,
        createdAt: now,
    });
    deps.repo.insert(si);

    if (deps.bus) {
        const event: StandingInstructionCreatedEvent = {
            type: "StandingInstructionCreated",
            siId: si.id,
            ownerUserId: si.ownerUserId,
            fromAccountId: si.fromAccountId,
            beneficiaryId: si.beneficiaryId,
            amountMinor: si.amountMinor,
            currency: si.currency,
            frequency: si.frequency,
            nextRunAt: si.nextRunAt,
            createdAt: si.createdAt,
        };
        deps.bus.publish([event]);
    }
    return si;
}

export function pauseStandingInstruction(
    deps: { repo: StandingInstructionRepo; bus?: EventBus; clock?: Clock },
    args: { ownerUserId: string; id: string }
): void {
    const si = deps.repo.findById(args.id);
    if (!si || si.ownerUserId !== args.ownerUserId)
        throw new StandingInstructionNotFoundError();
    if (si.status !== "active")
        throw new StandingInstructionInvalidStateError(si.status, "paused");
    deps.repo.setStatus(si.id, "paused");

    if (deps.bus) {
        const event: StandingInstructionPausedEvent = {
            type: "StandingInstructionPaused",
            siId: si.id,
            ownerUserId: si.ownerUserId,
            pausedAt: deps.clock?.now() ?? new Date(),
        };
        deps.bus.publish([event]);
    }
}

export function resumeStandingInstruction(
    deps: { repo: StandingInstructionRepo; bus?: EventBus; clock?: Clock },
    args: { ownerUserId: string; id: string }
): void {
    const si = deps.repo.findById(args.id);
    if (!si || si.ownerUserId !== args.ownerUserId)
        throw new StandingInstructionNotFoundError();
    if (si.status !== "paused")
        throw new StandingInstructionInvalidStateError(si.status, "active");
    deps.repo.setStatus(si.id, "active");

    if (deps.bus) {
        const event: StandingInstructionResumedEvent = {
            type: "StandingInstructionResumed",
            siId: si.id,
            ownerUserId: si.ownerUserId,
            resumedAt: deps.clock?.now() ?? new Date(),
        };
        deps.bus.publish([event]);
    }
}

export function cancelStandingInstruction(
    deps: { repo: StandingInstructionRepo; bus?: EventBus; clock?: Clock },
    args: { ownerUserId: string; id: string }
): void {
    const si = deps.repo.findById(args.id);
    if (!si || si.ownerUserId !== args.ownerUserId)
        throw new StandingInstructionNotFoundError();
    if (si.status === "cancelled")
        throw new StandingInstructionInvalidStateError(si.status, "cancelled");
    deps.repo.setStatus(si.id, "cancelled");

    if (deps.bus) {
        const event: StandingInstructionCancelledEvent = {
            type: "StandingInstructionCancelled",
            siId: si.id,
            ownerUserId: si.ownerUserId,
            cancelledAt: deps.clock?.now() ?? new Date(),
        };
        deps.bus.publish([event]);
    }
}
