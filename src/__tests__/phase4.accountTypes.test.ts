import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import {
    createAccountForUser,
    openAdditionalAccount,
} from "../contexts/accounts/application/createAccount";

test("createAccountForUser is idempotent per (user, type) but not across types", () => {
    const env = makeTestEnv();
    const u = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const deps = { repo: env.repos.accounts, ids: env.ids, clock: env.clock };

    const savings1 = createAccountForUser(deps, u.id, "savings");
    const savings2 = createAccountForUser(deps, u.id, "savings");
    assert.equal(savings1.id, savings2.id, "same type returns same account");

    const current = createAccountForUser(deps, u.id, "current");
    assert.notEqual(savings1.id, current.id, "different type creates new account");
    assert.equal(current.accountType, "current");

    const fd = createAccountForUser(deps, u.id, "fixed_deposit");
    assert.equal(fd.accountType, "fixed_deposit");

    const all = env.repos.accounts.listByUserId(u.id);
    assert.equal(all.length, 3);
});

test("openAdditionalAccount always creates a new row", () => {
    const env = makeTestEnv();
    const u = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const deps = { repo: env.repos.accounts, ids: env.ids, clock: env.clock };

    createAccountForUser(deps, u.id, "savings");
    const second = openAdditionalAccount(deps, { userId: u.id, accountType: "savings" });
    const third = openAdditionalAccount(deps, { userId: u.id, accountType: "current" });

    const all = env.repos.accounts.listByUserId(u.id);
    assert.equal(all.length, 3);
    assert.equal(second.accountType, "savings");
    assert.equal(third.accountType, "current");
    assert.notEqual(second.accountNumber, third.accountNumber);
});
