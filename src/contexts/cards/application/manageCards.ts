import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { AccountRepo } from "../../accounts/application/ports";
import { createCard, type CardNetwork, type DebitCard } from "../domain/card";
import { CardInvalidStateError, CardNotFoundError } from "../domain/errors";
import { AccountNotFoundError } from "../../accounts/domain/errors";
import type { DebitCardRepo } from "./ports";

export function issueCard(
    deps: { repo: DebitCardRepo; accounts: AccountRepo; ids: IdGenerator; clock: Clock },
    args: { ownerUserId: string; accountId: string; network?: CardNetwork }
): DebitCard {
    const account = deps.accounts.findById(args.accountId);
    if (!account || account.userId !== args.ownerUserId) throw new AccountNotFoundError();

    const card = createCard({
        id: deps.ids.uuid(),
        accountId: args.accountId,
        network: args.network ?? "visa",
        issuedAt: deps.clock.now(),
    });
    deps.repo.insert(card);
    return card;
}

export function freezeCard(
    deps: { repo: DebitCardRepo; accounts: AccountRepo; clock: Clock },
    args: { ownerUserId: string; cardId: string }
): DebitCard {
    const card = mustOwn(deps, args);
    if (card.status === "cancelled")
        throw new CardInvalidStateError(card.status, "frozen");
    if (card.status === "frozen") return card;
    const updated: DebitCard = {
        ...card,
        status: "frozen",
        frozenAt: deps.clock.now(),
    };
    deps.repo.update(updated);
    return updated;
}

export function unfreezeCard(
    deps: { repo: DebitCardRepo; accounts: AccountRepo; clock: Clock },
    args: { ownerUserId: string; cardId: string }
): DebitCard {
    const card = mustOwn(deps, args);
    if (card.status === "cancelled")
        throw new CardInvalidStateError(card.status, "active");
    if (card.status === "active") return card;
    const updated: DebitCard = {
        ...card,
        status: "active",
        frozenAt: undefined,
    };
    deps.repo.update(updated);
    return updated;
}

export function cancelCard(
    deps: { repo: DebitCardRepo; accounts: AccountRepo; clock: Clock },
    args: { ownerUserId: string; cardId: string }
): DebitCard {
    const card = mustOwn(deps, args);
    if (card.status === "cancelled") return card;
    const updated: DebitCard = {
        ...card,
        status: "cancelled",
        cancelledAt: deps.clock.now(),
    };
    deps.repo.update(updated);
    return updated;
}

function mustOwn(
    deps: { repo: DebitCardRepo; accounts: AccountRepo },
    args: { ownerUserId: string; cardId: string }
): DebitCard {
    const card = deps.repo.findById(args.cardId);
    if (!card) throw new CardNotFoundError();
    const account = deps.accounts.findById(card.accountId);
    if (!account || account.userId !== args.ownerUserId) throw new CardNotFoundError();
    return card;
}
