import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv, grantBankingAccess } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";
import { executeTransfer } from "../contexts/payments/application/executeTransfer";
import {
    DEFAULT_DAILY_LIMIT_MINOR,
    limitsForTier,
} from "../services/transferLimits";
import { TransferAggregateLimitError } from "../contexts/payments/domain/errors";

test("tier limits scale daily cap", () => {
    const basic = limitsForTier("basic");
    const none = limitsForTier("none");
    assert.equal(basic.dailyLimitMinor, DEFAULT_DAILY_LIMIT_MINOR);
    assert.ok(none.dailyLimitMinor < basic.dailyLimitMinor);
});

test("kycTier none blocks outbound transfers", () => {
    const env = makeTestEnv();
    const alice = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "limit-alice"
    );
    const bob = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "limit-bob"
    );
    const aAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        alice.id
    );
    const bAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        bob.id
    );
    grantBankingAccess(env, alice.id);

    const faucetMax = 100_000_00;
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            toAccountId: aAcc.id,
            amountMinor: faucetMax,
            currency: "INR",
            idempotencyKey: "fund-0",
        }
    );

    assert.throws(
        () =>
            executeTransfer(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: aAcc.id,
                    toAccountNumber: bAcc.accountNumber,
                    amountMinor: 1_00,
                    currency: "INR",
                    ownerUserId: alice.id,
                    kycTier: "none",
                }
            ),
        (e) => e instanceof TransferAggregateLimitError
    );
});
