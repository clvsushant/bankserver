import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import { open } from "../domain/account";
import type { Account, AccountType } from "../domain/account";
import type { AccountOpenedEvent } from "../domain/events";
import type { AccountRepo } from "./ports";

type Deps = { repo: AccountRepo; ids: IdGenerator; clock: Clock; bus?: EventBus };

function publishOpened(deps: Deps, account: Account): void {
    if (!deps.bus) return;
    const event: AccountOpenedEvent = {
        type: "AccountOpened",
        accountId: account.id,
        accountNumber: account.accountNumber,
        userId: account.userId,
        accountType: account.accountType,
        openedAt: account.createdAt,
    };
    deps.bus.publish([event]);
}

/**
 * Used by the KycApproved subscriber. Idempotent w.r.t. (userId, accountType).
 * The first time a user is approved we open one account; if the subscriber
 * fires again (e.g. duplicate event) and an account of the same type
 * already exists, we return it.
 *
 * For opening additional accounts after KYC use {@link openAdditionalAccount}.
 */
export function createAccountForUser(
    deps: Deps,
    userId: string,
    accountType: AccountType = "savings"
): Account {
    const existing = deps.repo.listByUserId(userId);
    const sameType = existing.find((a) => a.accountType === accountType);
    if (sameType) return sameType;

    let accountNumber = deps.ids.accountNumber();
    while (deps.repo.findByAccountNumber(accountNumber)) {
        accountNumber = deps.ids.accountNumber();
    }
    const account = open({
        id: deps.ids.uuid(),
        accountNumber,
        userId,
        accountType,
        createdAt: deps.clock.now(),
    });
    deps.repo.insert(account);
    publishOpened(deps, account);
    return account;
}

/**
 * Opens an *additional* account for a user that has already completed KYC.
 * Always creates a fresh account (does not de-duplicate by type — the user
 * may legitimately want two Savings accounts for budgeting). Caller is
 * expected to enforce reasonable per-user account caps if desired.
 */
export function openAdditionalAccount(
    deps: Deps,
    args: { userId: string; accountType: AccountType }
): Account {
    let accountNumber = deps.ids.accountNumber();
    while (deps.repo.findByAccountNumber(accountNumber)) {
        accountNumber = deps.ids.accountNumber();
    }
    const account = open({
        id: deps.ids.uuid(),
        accountNumber,
        userId: args.userId,
        accountType: args.accountType,
        createdAt: deps.clock.now(),
    });
    deps.repo.insert(account);
    publishOpened(deps, account);
    return account;
}
