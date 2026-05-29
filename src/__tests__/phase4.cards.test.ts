import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { setKycTier } from "../contexts/identity/application/kycTier";
import {
    cancelCard,
    freezeCard,
    issueCard,
    unfreezeCard,
} from "../contexts/cards/application/manageCards";
import { CardInvalidStateError, CardNotFoundError } from "../contexts/cards/domain/errors";
import { AccountNotFoundError } from "../contexts/accounts/domain/errors";
import { defaultLimitsForTier } from "../services/cardLimits";

function cardDeps(env: ReturnType<typeof makeTestEnv>) {
    return {
        repo: env.repos.cards,
        accounts: env.repos.accounts,
        users: env.repos.users,
        ids: env.ids,
        clock: env.clock,
    };
}

function setup() {
    const env = makeTestEnv();
    const owner = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const stranger = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "mallory"
    );
    const account = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        owner.id
    );
    setKycTier({ users: env.repos.users }, owner.id, "full");
    return { env, owner, stranger, account };
}

test("issueCard generates a masked number and active status", () => {
    const { env, owner, account } = setup();
    const c = issueCard(cardDeps(env), {
        ownerUserId: owner.id,
        accountId: account.id,
        network: "rupay",
    });
    assert.equal(c.status, "active");
    assert.equal(c.network, "rupay");
    assert.match(c.maskedNumber, /^\d{4}-XXXX-XXXX-\d{4}$/);
    const defaults = defaultLimitsForTier("full");
    assert.equal(c.perTxnLimitMinor, defaults.perTxnLimitMinor);
});

test("issueCard refuses an account the caller does not own", () => {
    const { env, stranger, account } = setup();
    assert.throws(
        () =>
            issueCard(cardDeps(env), {
                ownerUserId: stranger.id,
                accountId: account.id,
            }),
        AccountNotFoundError
    );
});

test("freeze/unfreeze/cancel transitions and ownership checks", () => {
    const { env, owner, stranger, account } = setup();
    const c = issueCard(cardDeps(env), { ownerUserId: owner.id, accountId: account.id });
    const baseDeps = {
        repo: env.repos.cards,
        accounts: env.repos.accounts,
        clock: env.clock,
    };

    const frozen = freezeCard(baseDeps, { ownerUserId: owner.id, cardId: c.id });
    assert.equal(frozen.status, "frozen");
    assert.ok(frozen.frozenAt instanceof Date);

    const unfrozen = unfreezeCard(baseDeps, { ownerUserId: owner.id, cardId: c.id });
    assert.equal(unfrozen.status, "active");
    assert.equal(unfrozen.frozenAt, undefined);

    assert.throws(
        () => freezeCard(baseDeps, { ownerUserId: stranger.id, cardId: c.id }),
        CardNotFoundError
    );

    const cancelled = cancelCard(baseDeps, { ownerUserId: owner.id, cardId: c.id });
    assert.equal(cancelled.status, "cancelled");
    assert.throws(
        () => freezeCard(baseDeps, { ownerUserId: owner.id, cardId: c.id }),
        CardInvalidStateError
    );
});
