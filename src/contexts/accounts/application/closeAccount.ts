import type { Clock } from "../../../shared/clock";
import type { EventBus } from "../../../shared/eventBus";
import type { AccountRepo, FixedDepositRepo } from "./ports";
import type { DebitCardRepo } from "../../cards/application/ports";
import type { StandingInstructionRepo } from "../../standingInstructions/application/ports";
import { close } from "../domain/account";
import {
    AccountCloseBlockedError,
    AccountNotFoundError,
} from "../domain/errors";
import type { Account } from "../domain/account";
import type { AccountClosedEvent } from "../domain/events";

export function closeAccount(
    deps: {
        accounts: AccountRepo;
        fixedDeposits: FixedDepositRepo;
        cards: DebitCardRepo;
        standingInstructions: StandingInstructionRepo;
        clock: Clock;
        bus?: EventBus;
    },
    input: { userId: string; accountId: string }
): Account {
    const account = deps.accounts.findById(input.accountId);
    if (!account || account.userId !== input.userId) throw new AccountNotFoundError();
    if (account.accountType === "fixed_deposit")
        throw new AccountCloseBlockedError("Close the fixed deposit via maturity or premature closure");

    const activeFd = deps.fixedDeposits.findByAccountId(account.id);
    if (activeFd?.status === "active")
        throw new AccountCloseBlockedError("Account is linked to an active fixed deposit");

    const cards = deps.cards.listByAccount(account.id);
    if (cards.some((c) => c.status === "active"))
        throw new AccountCloseBlockedError("Account has active debit cards");

    const sis = deps.standingInstructions.listByOwner(input.userId);
    if (sis.some((si) => si.status === "active" && si.fromAccountId === account.id))
        throw new AccountCloseBlockedError("Account has active standing instructions");

    const userFds = deps.fixedDeposits.listActiveByUserId(input.userId);
    if (userFds.some((fd) => fd.payoutAccountId === account.id))
        throw new AccountCloseBlockedError("Account is payout account for active fixed deposits");

    const now = deps.clock.now();
    const closed = close(account, now);
    deps.accounts.update(closed);

    if (deps.bus) {
        const event: AccountClosedEvent = {
            type: "AccountClosed",
            accountId: closed.id,
            accountNumber: closed.accountNumber,
            userId: closed.userId,
            closedAt: now,
        };
        deps.bus.publish([event]);
    }
    return closed;
}
