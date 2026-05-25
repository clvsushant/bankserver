import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";
import { executeTransfer } from "../contexts/payments/application/executeTransfer";
import { getMonthlyStatement } from "../contexts/statements/application/getMonthlyStatement";

test("monthly statement includes only the requested month", () => {
    const env = makeTestEnv(new Date("2026-04-15T10:00:00Z"));
    const alice = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const bob = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "bob"
    );
    const aAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        alice.id
    );
    const bAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        bob.id
    );

    // April: faucet 200, transfer 50 out
    env.clock.set(new Date("2026-04-15T10:00:00Z"));
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: 200_00, currency: "INR" }
    );
    env.clock.set(new Date("2026-04-20T10:00:00Z"));
    executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 50_00,
            currency: "INR",
        }
    );

    // May: transfer 25 out
    env.clock.set(new Date("2026-05-05T10:00:00Z"));
    executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 25_00,
            currency: "INR",
        }
    );

    const apr = getMonthlyStatement(env.db, { accountId: aAcc.id, month: "2026-04" });
    assert.equal(apr.month, "2026-04");
    assert.equal(apr.lines.length, 2); // credit (faucet) + debit (transfer)
    assert.equal(apr.totalCreditMinor, 200_00);
    assert.equal(apr.totalDebitMinor, 50_00);
    assert.equal(apr.openingBalanceMinor, 0);
    assert.equal(apr.closingBalanceMinor, 150_00);

    const may = getMonthlyStatement(env.db, { accountId: aAcc.id, month: "2026-05" });
    assert.equal(may.lines.length, 1);
    assert.equal(may.totalDebitMinor, 25_00);
    assert.equal(may.closingBalanceMinor, 125_00);
});

test("invalid month string throws", () => {
    const env = makeTestEnv();
    assert.throws(() => getMonthlyStatement(env.db, { accountId: "x", month: "2026-13" }));
    assert.throws(() => getMonthlyStatement(env.db, { accountId: "x", month: "26-01" }));
});

test("December rolls over to next year correctly (no off-by-one)", () => {
    const env = makeTestEnv(new Date("2026-12-30T12:00:00Z"));
    const alice = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const aAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        alice.id
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: 1_00, currency: "INR" }
    );

    // Different month — should be empty
    const stmt = getMonthlyStatement(env.db, { accountId: aAcc.id, month: "2027-01" });
    assert.equal(stmt.lines.length, 0);

    const dec = getMonthlyStatement(env.db, { accountId: aAcc.id, month: "2026-12" });
    assert.equal(dec.lines.length, 1);
});
