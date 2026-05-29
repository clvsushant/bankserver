import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { closeAccount } from "../contexts/accounts/application/closeAccount";
import { AccountCloseRequiresZeroBalanceError } from "../contexts/accounts/domain/errors";
import { credit } from "../contexts/accounts/domain/account";

test("close account requires zero balance", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "close-user"
    );
    const acc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        user.id
    );
    const funded = credit(acc, 100, "INR", env.clock.now());
    env.repos.accounts.update(funded);

    assert.throws(
        () =>
            closeAccount(
                {
                    accounts: env.repos.accounts,
                    fixedDeposits: env.repos.fixedDeposits,
                    cards: env.repos.cards,
                    standingInstructions: env.repos.standingInstructions,
                    clock: env.clock,
                },
                { userId: user.id, accountId: acc.id }
            ),
        (e) => e instanceof AccountCloseRequiresZeroBalanceError
    );
});

test("close zero-balance account succeeds", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "close-ok"
    );
    const acc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        user.id
    );
    const closed = closeAccount(
        {
            accounts: env.repos.accounts,
            fixedDeposits: env.repos.fixedDeposits,
            cards: env.repos.cards,
            standingInstructions: env.repos.standingInstructions,
            clock: env.clock,
        },
        { userId: user.id, accountId: acc.id }
    );
    assert.equal(closed.status, "Closed");
});
