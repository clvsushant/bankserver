import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { AccountRepo } from "../../accounts/application/ports";
import type { UserRepo } from "../../identity/application/ports";
import { getKycTier } from "../../identity/application/kycTier";
import {
    defaultLimitsForTier,
    validateLimitsAgainstBankMax,
    type CardLimits,
} from "../../../services/cardLimits";
import { createCard, type CardNetwork, type DebitCard } from "../domain/card";
import {
    CardInvalidStateError,
    CardLimitAboveBankMaxError,
    CardNotFoundError,
} from "../domain/errors";
import { AccountNotFoundError } from "../../accounts/domain/errors";
import type { DebitCardRepo } from "./ports";

export function issueCard(
    deps: {
        repo: DebitCardRepo;
        accounts: AccountRepo;
        users: UserRepo;
        ids: IdGenerator;
        clock: Clock;
    },
    args: { ownerUserId: string; accountId: string; network?: CardNetwork }
): DebitCard {
    const account = deps.accounts.findById(args.accountId);
    if (!account || account.userId !== args.ownerUserId) throw new AccountNotFoundError();

    const tier = getKycTier({ users: deps.users }, args.ownerUserId);
    const defaults = defaultLimitsForTier(tier);

    const card = createCard({
        id: deps.ids.uuid(),
        accountId: args.accountId,
        network: args.network ?? "visa",
        issuedAt: deps.clock.now(),
        ...defaults,
    });
    deps.repo.insert(card);
    return card;
}

export function setCardLimits(
    deps: {
        repo: DebitCardRepo;
        accounts: AccountRepo;
        users: UserRepo;
        clock: Clock;
    },
    args: {
        ownerUserId: string;
        cardId: string;
        perTxnLimitMinor: number;
        dailyLimitMinor: number;
        monthlyLimitMinor: number;
    }
): DebitCard {
    const card = mustOwn(deps, args);
    if (card.status === "cancelled")
        throw new CardInvalidStateError(card.status, "limits update");

    const limits: CardLimits = {
        perTxnLimitMinor: args.perTxnLimitMinor,
        dailyLimitMinor: args.dailyLimitMinor,
        monthlyLimitMinor: args.monthlyLimitMinor,
    };

    if (
        !Number.isInteger(limits.perTxnLimitMinor) ||
        limits.perTxnLimitMinor <= 0 ||
        !Number.isInteger(limits.dailyLimitMinor) ||
        limits.dailyLimitMinor <= 0 ||
        !Number.isInteger(limits.monthlyLimitMinor) ||
        limits.monthlyLimitMinor <= 0
    ) {
        throw new CardLimitAboveBankMaxError("limits");
    }

    const tier = getKycTier({ users: deps.users }, args.ownerUserId);
    const valid = validateLimitsAgainstBankMax(limits, tier);
    if (!valid.ok) throw new CardLimitAboveBankMaxError(valid.field);

    const updated: DebitCard = {
        ...card,
        perTxnLimitMinor: limits.perTxnLimitMinor,
        dailyLimitMinor: limits.dailyLimitMinor,
        monthlyLimitMinor: limits.monthlyLimitMinor,
    };
    deps.repo.update(updated);
    return updated;
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
