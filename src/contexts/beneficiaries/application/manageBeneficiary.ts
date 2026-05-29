import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import type { AccountRepo } from "../../accounts/application/ports";
import type { UserRepo } from "../../identity/application/ports";
import {
    BENEFICIARY_COOLING_MS,
    createBeneficiary,
    renameBeneficiaryNickname,
    type Beneficiary,
} from "../domain/beneficiary";
import {
    BeneficiaryAlreadyExistsError,
    BeneficiaryNotFoundError,
    BeneficiarySelfTargetError,
    BeneficiaryUnknownAccountError,
} from "../domain/errors";
import type {
    BeneficiaryAddedEvent,
    BeneficiaryRemovedEvent,
    BeneficiaryRenamedEvent,
} from "../domain/events";
import type { BeneficiaryRepo } from "./ports";

export function addBeneficiary(
    deps: {
        repo: BeneficiaryRepo;
        accounts: AccountRepo;
        users: UserRepo;
        ids: IdGenerator;
        clock: Clock;
        bus?: EventBus;
    },
    args: { ownerUserId: string; nickname: string; accountNumber: string }
): Beneficiary {
    const target = deps.accounts.findByAccountNumber(args.accountNumber);
    if (!target) throw new BeneficiaryUnknownAccountError();
    if (target.userId === args.ownerUserId) throw new BeneficiarySelfTargetError();

    const existing = deps.repo.findByOwnerAndAccount(args.ownerUserId, args.accountNumber);
    if (existing) throw new BeneficiaryAlreadyExistsError();

    const counterparty = deps.users.findById(target.userId);
    const now = deps.clock.now();
    const activatedAt = new Date(now.getTime() + BENEFICIARY_COOLING_MS);
    const beneficiary = createBeneficiary({
        id: deps.ids.uuid(),
        ownerUserId: args.ownerUserId,
        nickname: args.nickname,
        accountNumber: args.accountNumber,
        beneficiaryUsername: counterparty?.username,
        status: "pending",
        activatedAt,
        createdAt: now,
    });
    deps.repo.insert(beneficiary);

    if (deps.bus) {
        const event: BeneficiaryAddedEvent = {
            type: "BeneficiaryAdded",
            beneficiaryId: beneficiary.id,
            ownerUserId: beneficiary.ownerUserId,
            accountNumber: beneficiary.accountNumber,
            nickname: beneficiary.nickname,
            addedAt: beneficiary.createdAt,
        };
        deps.bus.publish([event]);
    }
    return beneficiary;
}

export function renameBeneficiary(
    deps: { repo: BeneficiaryRepo; bus?: EventBus; clock: Clock },
    args: { ownerUserId: string; beneficiaryId: string; nickname: string }
): Beneficiary {
    const b = deps.repo.findById(args.beneficiaryId);
    if (!b || b.ownerUserId !== args.ownerUserId) throw new BeneficiaryNotFoundError();
    const updated = renameBeneficiaryNickname(b, args.nickname);
    deps.repo.update(updated);

    if (deps.bus) {
        const event: BeneficiaryRenamedEvent = {
            type: "BeneficiaryRenamed",
            beneficiaryId: updated.id,
            ownerUserId: updated.ownerUserId,
            oldNickname: b.nickname,
            newNickname: updated.nickname,
            renamedAt: deps.clock.now(),
        };
        deps.bus.publish([event]);
    }
    return updated;
}

export function removeBeneficiary(
    deps: { repo: BeneficiaryRepo; bus?: EventBus; clock?: Clock },
    args: { ownerUserId: string; beneficiaryId: string }
): void {
    const b = deps.repo.findById(args.beneficiaryId);
    if (!b) throw new BeneficiaryNotFoundError();
    if (b.ownerUserId !== args.ownerUserId) throw new BeneficiaryNotFoundError();
    deps.repo.delete(b.id);

    if (deps.bus) {
        const event: BeneficiaryRemovedEvent = {
            type: "BeneficiaryRemoved",
            beneficiaryId: b.id,
            ownerUserId: b.ownerUserId,
            accountNumber: b.accountNumber,
            removedAt: deps.clock?.now() ?? new Date(),
        };
        deps.bus.publish([event]);
    }
}

/** Stamps last_used_at after a successful transfer to the saved account number. */
export function touchBeneficiaryByAccount(
    deps: { repo: BeneficiaryRepo; clock: Clock },
    args: { ownerUserId: string; accountNumber: string }
): void {
    const b = deps.repo.findByOwnerAndAccount(args.ownerUserId, args.accountNumber);
    if (b) deps.repo.touch(b.id, deps.clock.now());
}
