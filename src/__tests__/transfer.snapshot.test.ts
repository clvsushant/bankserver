import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { executeTransfer } from "../contexts/payments/application/executeTransfer";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";

function bootTwoUsers() {
    const env = makeTestEnv();
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
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: 100_000, currency: "INR" }
    );
    return { env, alice, bob, aAcc, bAcc };
}

test("executeTransfer snapshots counterparty info + reference number", () => {
    const { env, alice, bob, aAcc, bAcc } = bootTwoUsers();
    const t = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 50_00,
            currency: "INR",
        }
    );

    assert.match(t.referenceNumber!, /^TXN-[A-F0-9]{4}-[A-F0-9]{4}$/);
    assert.equal(t.feeMinor, 0);
    assert.equal(t.category, "p2p");
    assert.equal(t.fromAccountNumber, aAcc.accountNumber);
    assert.equal(t.toAccountNumber, bAcc.accountNumber);
    assert.equal(t.fromUsername, alice.username);
    assert.equal(t.toUsername, bob.username);
    assert.match(t.description ?? "", /Sent to bob/);

    // round-trip via repo
    const reread = env.repos.transfers.findById(t.id)!;
    assert.equal(reread.referenceNumber, t.referenceNumber);
    assert.equal(reread.toUsername, "bob");
});

test("faucetDeposit snapshots faucet category + sentinel from-username", () => {
    const env = makeTestEnv();
    const u = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const acc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        u.id
    );
    const t = faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: acc.id, amountMinor: 10_00, currency: "INR", memo: "First deposit" }
    );
    assert.equal(t.category, "faucet");
    assert.equal(t.fromAccountNumber, undefined);
    assert.equal(t.toAccountNumber, acc.accountNumber);
    assert.equal(t.toUsername, "alice");
    assert.match(t.description ?? "", /First deposit/);
});

test("self-transfer between own accounts is categorized as 'self'", () => {
    const env = makeTestEnv();
    const u = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const a1 = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        u.id
    );
    // createAccountForUser is idempotent per user; manually insert a second
    // account to test the self-transfer path.
    const a2 = {
        id: env.ids.uuid(),
        accountNumber: env.ids.accountNumber(),
        userId: u.id,
        accountType: "savings" as const,
        status: "Active" as const,
        balanceMinor: 0,
        currency: "INR" as const,
        createdAt: env.clock.now(),
        updatedAt: env.clock.now(),
    };
    env.repos.accounts.insert(a2);
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: a1.id, amountMinor: 100_000, currency: "INR" }
    );
    const t = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: a1.id,
            toAccountNumber: a2.accountNumber,
            amountMinor: 50_00,
            currency: "INR",
        }
    );
    assert.equal(t.category, "self");
    assert.match(t.description ?? "", /^Self transfer to /);
});

test("listByTransferId returns both ledger entries for a posted transfer", () => {
    const { env, aAcc, bAcc } = bootTwoUsers();
    const t = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 50_00,
            currency: "INR",
        }
    );
    const entries = env.repos.ledger.listByTransferId(t.id);
    assert.equal(entries.length, 2);
    const debit = entries.find((e) => e.kind === "debit")!;
    const credit = entries.find((e) => e.kind === "credit")!;
    assert.equal(debit.accountId, aAcc.id);
    assert.equal(credit.accountId, bAcc.id);
});
