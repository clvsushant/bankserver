import type { Clock } from "../../../shared/clock";
import type { EventBus } from "../../../shared/eventBus";
import { freeze, unfreeze } from "../domain/account";
import { AccountNotFoundError } from "../domain/errors";
import type {
    AccountFrozenEvent,
    AccountUnfrozenEvent,
} from "../domain/events";
import type { AccountRepo } from "./ports";

type Deps = { repo: AccountRepo; clock: Clock; bus?: EventBus };

export function freezeAccount(deps: Deps, args: { accountId: string }) {
    const acc = deps.repo.findById(args.accountId);
    if (!acc) throw new AccountNotFoundError();
    const next = freeze(acc, deps.clock.now());
    deps.repo.update(next);

    if (deps.bus) {
        const event: AccountFrozenEvent = {
            type: "AccountFrozen",
            accountId: next.id,
            accountNumber: next.accountNumber,
            userId: next.userId,
            frozenAt: next.updatedAt,
        };
        deps.bus.publish([event]);
    }
    return next;
}

export function unfreezeAccount(deps: Deps, args: { accountId: string }) {
    const acc = deps.repo.findById(args.accountId);
    if (!acc) throw new AccountNotFoundError();
    const next = unfreeze(acc, deps.clock.now());
    deps.repo.update(next);

    if (deps.bus) {
        const event: AccountUnfrozenEvent = {
            type: "AccountUnfrozen",
            accountId: next.id,
            accountNumber: next.accountNumber,
            userId: next.userId,
            unfrozenAt: next.updatedAt,
        };
        deps.bus.publish([event]);
    }
    return next;
}
