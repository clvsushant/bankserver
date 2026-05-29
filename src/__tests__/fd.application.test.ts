import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";
import { openFixedDeposit } from "../contexts/accounts/application/openFixedDeposit";
import { FD_MIN_PRINCIPAL_MINOR } from "../contexts/accounts/domain/fixedDeposit";
import { FixedDepositWithdrawalBlockedError } from "../contexts/accounts/domain/errors";
import { executeTransfer } from "../contexts/payments/application/executeTransfer";

test("open FD debits payout and creates FD account", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "fd-user"
    );
    const savings = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        user.id
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            toAccountId: savings.id,
            amountMinor: FD_MIN_PRINCIPAL_MINOR + 50_000 + 50_000,
            currency: "INR",
        }
    );

    const fd = openFixedDeposit(
        {
            db: env.db,
            accounts: env.repos.accounts,
            fixedDeposits: env.repos.fixedDeposits,
            ids: env.ids,
            clock: env.clock,
        },
        {
            userId: user.id,
            payoutAccountId: savings.id,
            principalMinor: FD_MIN_PRINCIPAL_MINOR,
            tenureMonths: 12,
        }
    );

    assert.equal(fd.status, "active");
    assert.equal(fd.principalMinor, FD_MIN_PRINCIPAL_MINOR);
    const payout = env.repos.accounts.findById(savings.id)!;
    const fdAcc = env.repos.accounts.findById(fd.accountId)!;
    assert.equal(fdAcc.accountType, "fixed_deposit");
    assert.equal(fdAcc.balanceMinor, FD_MIN_PRINCIPAL_MINOR);
    assert.ok(payout.balanceMinor < FD_MIN_PRINCIPAL_MINOR + 50_000);
});

test("cannot debit FD account via transfer", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "fd-block"
    );
    const bob = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "fd-bob"
    );
    const savings = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        user.id
    );
    const bobAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        bob.id
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            toAccountId: savings.id,
            amountMinor: FD_MIN_PRINCIPAL_MINOR + 50_000 + 100_00,
            currency: "INR",
        }
    );
    openFixedDeposit(
        {
            db: env.db,
            accounts: env.repos.accounts,
            fixedDeposits: env.repos.fixedDeposits,
            ids: env.ids,
            clock: env.clock,
        },
        {
            userId: user.id,
            payoutAccountId: savings.id,
            principalMinor: FD_MIN_PRINCIPAL_MINOR,
            tenureMonths: 12,
        }
    );
    const fd = env.repos.fixedDeposits.listActiveByUserId(user.id)[0]!;

    assert.throws(
        () =>
            executeTransfer(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: fd.accountId,
                    toAccountNumber: bobAcc.accountNumber,
                    amountMinor: 100,
                    currency: "INR",
                }
            ),
        (e) => e instanceof FixedDepositWithdrawalBlockedError
    );
});
