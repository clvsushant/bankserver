import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv, grantBankingAccess } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { addBeneficiary } from "../contexts/beneficiaries/application/manageBeneficiary";
import { isTransferAllowed, BENEFICIARY_COOLING_MS } from "../contexts/beneficiaries/domain/beneficiary";
import { BeneficiaryCoolingPeriodError } from "../contexts/beneficiaries/domain/errors";
import { executeTransfer } from "../contexts/payments/application/executeTransfer";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";

test("new beneficiary is pending with 24h cooling", () => {
    const env = makeTestEnv();
    const alice = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "cool-alice"
    );
    const bob = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "cool-bob"
    );
    const aAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        alice.id
    );
    const bAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        bob.id
    );

    const b = addBeneficiary(
        {
            repo: env.repos.beneficiaries,
            accounts: env.repos.accounts,
            users: env.repos.users,
            ids: env.ids,
            clock: env.clock,
        },
        { ownerUserId: alice.id, nickname: "Bob", accountNumber: bAcc.accountNumber }
    );

    assert.equal(b.status, "pending");
    assert.ok(b.activatedAt);
    assert.equal(isTransferAllowed(b, env.clock.now()), false);
    void aAcc;
});

test("transfer blocked during cooling when beneficiaryId used", () => {
    const env = makeTestEnv();
    const alice = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "cool-tx-alice"
    );
    const bob = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "cool-tx-bob"
    );
    const aAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        alice.id
    );
    const bAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        bob.id
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: 10_000_00, currency: "INR" }
    );
    grantBankingAccess(env, alice.id);

    const ben = addBeneficiary(
        {
            repo: env.repos.beneficiaries,
            accounts: env.repos.accounts,
            users: env.repos.users,
            ids: env.ids,
            clock: env.clock,
        },
        { ownerUserId: alice.id, nickname: "Bob", accountNumber: bAcc.accountNumber }
    );

    assert.throws(
        () =>
            executeTransfer(
                {
                    db: env.db,
                    clock: env.clock,
                    ids: env.ids,
                    bus: env.bus,
                    beneficiaries: env.repos.beneficiaries,
                },
                {
                    fromAccountId: aAcc.id,
                    toAccountNumber: bAcc.accountNumber,
                    amountMinor: 100_00,
                    currency: "INR",
                    beneficiaryId: ben.id,
                    ownerUserId: alice.id,
                    kycTier: "basic",
                }
            ),
        (e) => e instanceof BeneficiaryCoolingPeriodError
    );
});

test("transfer allowed after cooling elapses", () => {
    const env = makeTestEnv();
    const alice = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "cool-ok-alice"
    );
    const bob = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "cool-ok-bob"
    );
    const aAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        alice.id
    );
    const bAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        bob.id
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: 10_000_00, currency: "INR" }
    );
    grantBankingAccess(env, alice.id);

    const ben = addBeneficiary(
        {
            repo: env.repos.beneficiaries,
            accounts: env.repos.accounts,
            users: env.repos.users,
            ids: env.ids,
            clock: env.clock,
        },
        { ownerUserId: alice.id, nickname: "Bob", accountNumber: bAcc.accountNumber }
    );

    env.clock.advance(BENEFICIARY_COOLING_MS + 1);
    const t = executeTransfer(
        {
            db: env.db,
            clock: env.clock,
            ids: env.ids,
            bus: env.bus,
            beneficiaries: env.repos.beneficiaries,
        },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 100_00,
            currency: "INR",
            beneficiaryId: ben.id,
            ownerUserId: alice.id,
            kycTier: "basic",
        }
    );
    assert.equal(t.status, "posted");
});
