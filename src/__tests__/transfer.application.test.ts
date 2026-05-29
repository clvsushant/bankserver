import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { executeTransfer } from "../contexts/payments/application/executeTransfer";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";
import { freezeAccount } from "../contexts/accounts/application/freezeAccount";
import {
    AccountNotActiveError,
    AccountNotFoundError,
    InsufficientAvailableFundsError,
} from "../contexts/accounts/domain/errors";
import {
    CrossUserFixedDepositTransferError,
    TransferAmountInvalidError,
    TransferOverLimitError,
    TransferToSelfError,
} from "../contexts/payments/domain/errors";
import { openAdditionalAccount } from "../contexts/accounts/application/createAccount";

/** Savings min balance is 50_000 paise; fund above that for debit tests. */
const SAVINGS_FUND = 100_000;
/** Current min balance is 1_000_000 paise. */
const CURRENT_FUND = 2_000_000;

function bootstrap() {
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
    return { env, alice, bob, aAcc, bAcc };
}

test("happy path: faucet -> transfer posts a debit + credit and updates balances", () => {
    const { env, aAcc, bAcc } = bootstrap();

    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: SAVINGS_FUND, currency: "INR" }
    );

    const t = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 30_00,
            currency: "INR",
            memo: "lunch",
        }
    );
    assert.equal(t.status, "posted");

    const a = env.repos.accounts.findById(aAcc.id)!;
    const b = env.repos.accounts.findById(bAcc.id)!;
    assert.equal(a.balanceMinor, SAVINGS_FUND - 30_00);
    assert.equal(b.balanceMinor, 30_00);

    // Double-entry invariant: sum of all ledger entries (with signed kinds) is zero
    const aEntries = env.repos.ledger.listByAccountId(aAcc.id, 100);
    const bEntries = env.repos.ledger.listByAccountId(bAcc.id, 100);
    const sum = [...aEntries, ...bEntries].reduce(
        (s, e) => s + (e.kind === "debit" ? -e.amountMinor : e.amountMinor),
        0
    );
    assert.equal(sum, SAVINGS_FUND);
});

test("insufficient funds throws and rolls back", () => {
    const { env, aAcc, bAcc } = bootstrap();
    assert.throws(
        () =>
            executeTransfer(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: aAcc.id,
                    toAccountNumber: bAcc.accountNumber,
                    amountMinor: 1_00,
                    currency: "INR",
                }
            ),
        (e) => e instanceof InsufficientAvailableFundsError
    );
    assert.equal(env.repos.accounts.findById(aAcc.id)!.balanceMinor, 0);
    assert.equal(env.repos.accounts.findById(bAcc.id)!.balanceMinor, 0);
    assert.equal(env.repos.transfers.list(10).length, 0);
});

test("idempotency key returns the same transfer without re-applying", () => {
    const { env, aAcc, bAcc } = bootstrap();
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: SAVINGS_FUND, currency: "INR" }
    );

    const args = {
        fromAccountId: aAcc.id,
        toAccountNumber: bAcc.accountNumber,
        amountMinor: 25_00,
        currency: "INR" as const,
        idempotencyKey: "idem-1",
    };
    const t1 = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        args
    );
    const t2 = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        args
    );
    assert.equal(t1.id, t2.id);
    assert.equal(env.repos.accounts.findById(aAcc.id)!.balanceMinor, SAVINGS_FUND - 25_00);
    assert.equal(env.repos.accounts.findById(bAcc.id)!.balanceMinor, 25_00);
});

test("transfer to same account is rejected", () => {
    const { env, aAcc } = bootstrap();
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: 100_00, currency: "INR" }
    );
    assert.throws(
        () =>
            executeTransfer(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: aAcc.id,
                    toAccountNumber: aAcc.accountNumber,
                    amountMinor: 1_00,
                    currency: "INR",
                }
            ),
        (e) => e instanceof TransferToSelfError
    );
});

test("transfer from frozen source account fails with AccountNotActiveError", () => {
    const { env, aAcc, bAcc } = bootstrap();
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: 100_00, currency: "INR" }
    );
    freezeAccount(
        { repo: env.repos.accounts, clock: env.clock },
        { accountId: aAcc.id }
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
                }
            ),
        (e) => e instanceof AccountNotActiveError
    );
});

test("amount must be > 0 and <= per-tx limit", () => {
    const { env, aAcc, bAcc } = bootstrap();
    assert.throws(
        () =>
            executeTransfer(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: aAcc.id,
                    toAccountNumber: bAcc.accountNumber,
                    amountMinor: 0,
                    currency: "INR",
                }
            ),
        (e) => e instanceof TransferAmountInvalidError
    );
    assert.throws(
        () =>
            executeTransfer(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: aAcc.id,
                    toAccountNumber: bAcc.accountNumber,
                    amountMinor: 100_000_01_00 /* over ₹10L */,
                    currency: "INR",
                }
            ),
        (e) => e instanceof TransferOverLimitError
    );
});

test("transfer to unknown account fails with AccountNotFoundError", () => {
    const { env, aAcc } = bootstrap();
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: 100_00, currency: "INR" }
    );
    assert.throws(
        () =>
            executeTransfer(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: aAcc.id,
                    toAccountNumber: "SBE-9999999999",
                    amountMinor: 1_00,
                    currency: "INR",
                }
            ),
        (e) => e instanceof AccountNotFoundError
    );
});

test("savings -> fixed_deposit across users is rejected", () => {
    const { env, alice, bob, aAcc } = bootstrap();
    // alice's default savings is `aAcc`. Open a fixed deposit for bob.
    const bobFd = openAdditionalAccount(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        { userId: bob.id, accountType: "fixed_deposit" }
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: 100_00, currency: "INR" }
    );

    assert.throws(
        () =>
            executeTransfer(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: aAcc.id,
                    toAccountNumber: bobFd.accountNumber,
                    amountMinor: 1_00,
                    currency: "INR",
                }
            ),
        (e) => e instanceof CrossUserFixedDepositTransferError
    );
    assert.equal(env.repos.accounts.findById(aAcc.id)!.balanceMinor, 100_00);
    assert.equal(env.repos.accounts.findById(bobFd.id)!.balanceMinor, 0);
    // Faucet deposit counts as 1 transfer; the rejected transfer must not be recorded.
    assert.equal(env.repos.transfers.list(10).length, 1);
    void alice;
});

test("current -> fixed_deposit across users is rejected", () => {
    const { env, alice, bob } = bootstrap();
    const aliceCurrent = openAdditionalAccount(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        { userId: alice.id, accountType: "current" }
    );
    const bobFd = openAdditionalAccount(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        { userId: bob.id, accountType: "fixed_deposit" }
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aliceCurrent.id, amountMinor: 100_00, currency: "INR" }
    );

    assert.throws(
        () =>
            executeTransfer(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: aliceCurrent.id,
                    toAccountNumber: bobFd.accountNumber,
                    amountMinor: 25_00,
                    currency: "INR",
                }
            ),
        (e) => e instanceof CrossUserFixedDepositTransferError
    );
    assert.equal(env.repos.accounts.findById(aliceCurrent.id)!.balanceMinor, 100_00);
    assert.equal(env.repos.accounts.findById(bobFd.id)!.balanceMinor, 0);
});

test("self transfer into own fixed_deposit is allowed (savings -> FD)", () => {
    const { env, alice, aAcc } = bootstrap();
    const aliceFd = openAdditionalAccount(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        { userId: alice.id, accountType: "fixed_deposit" }
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: SAVINGS_FUND, currency: "INR" }
    );

    const t = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: aliceFd.accountNumber,
            amountMinor: 40_00,
            currency: "INR",
            memo: "park into FD",
        }
    );
    assert.equal(t.status, "posted");
    assert.equal(t.category, "self");
    assert.equal(env.repos.accounts.findById(aAcc.id)!.balanceMinor, SAVINGS_FUND - 40_00);
    assert.equal(env.repos.accounts.findById(aliceFd.id)!.balanceMinor, 40_00);
});

test("self transfer into own fixed_deposit is allowed (current -> FD)", () => {
    const { env, alice } = bootstrap();
    const aliceCurrent = openAdditionalAccount(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        { userId: alice.id, accountType: "current" }
    );
    const aliceFd = openAdditionalAccount(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        { userId: alice.id, accountType: "fixed_deposit" }
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aliceCurrent.id, amountMinor: CURRENT_FUND, currency: "INR" }
    );

    const t = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aliceCurrent.id,
            toAccountNumber: aliceFd.accountNumber,
            amountMinor: 25_00,
            currency: "INR",
        }
    );
    assert.equal(t.status, "posted");
    assert.equal(t.category, "self");
    assert.equal(env.repos.accounts.findById(aliceCurrent.id)!.balanceMinor, CURRENT_FUND - 25_00);
    assert.equal(env.repos.accounts.findById(aliceFd.id)!.balanceMinor, 25_00);
});

test("cross-user transfer into a non-FD account is still allowed (current -> savings)", () => {
    // The new restriction is targeted: only the *destination* being an FD
    // owned by another user is blocked. Regular cross-user transfers are
    // unaffected.
    const { env, alice, bob, bAcc } = bootstrap();
    const aliceCurrent = openAdditionalAccount(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        { userId: alice.id, accountType: "current" }
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aliceCurrent.id, amountMinor: CURRENT_FUND, currency: "INR" }
    );

    const t = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aliceCurrent.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 30_00,
            currency: "INR",
        }
    );
    assert.equal(t.status, "posted");
    assert.equal(t.category, "p2p");
    assert.equal(env.repos.accounts.findById(aliceCurrent.id)!.balanceMinor, CURRENT_FUND - 30_00);
    assert.equal(env.repos.accounts.findById(bAcc.id)!.balanceMinor, 30_00);
    void bob;
});

test("MoneyMoved event is emitted only after a successful commit", () => {
    const { env, aAcc, bAcc } = bootstrap();
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: SAVINGS_FUND, currency: "INR" }
    );

    const events: string[] = [];
    env.bus.subscribe<{ type: "MoneyMoved" }>("MoneyMoved", () => events.push("ok"));

    // Failure: no event
    try {
        executeTransfer(
            { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
            {
                fromAccountId: aAcc.id,
                toAccountNumber: bAcc.accountNumber,
                amountMinor: 100_000_00,
                currency: "INR",
            }
        );
    } catch {
        /* expected */
    }
    assert.equal(events.length, 0);

    // Success: one event
    executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 1_00,
            currency: "INR",
        }
    );
    assert.equal(events.length, 1);
});
