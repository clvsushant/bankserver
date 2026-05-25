import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";
import { payBill } from "../contexts/bills/application/payBill";
import {
    BillerInactiveError,
    BillerNotFoundError,
} from "../contexts/bills/domain/errors";

function bootBiller(env: ReturnType<typeof makeTestEnv>) {
    const operator = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "billops"
    );
    const billerAccount = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        operator.id,
        "current"
    );
    const billerId = env.ids.uuid();
    env.repos.billers.insert({
        id: billerId,
        name: "Bharat Power",
        category: "electricity",
        billerAccountNumber: billerAccount.accountNumber,
        active: true,
        createdAt: env.clock.now(),
    });
    return { billerId, billerAccount };
}

test("payBill credits the biller's internal account and debits the customer", () => {
    const env = makeTestEnv();
    const { billerId, billerAccount } = bootBiller(env);

    const customer = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const fromAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        customer.id
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: fromAcc.id, amountMinor: 100_000, currency: "INR" }
    );

    const t = payBill(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: fromAcc.id,
            billerId,
            amountMinor: 25_000,
            currency: "INR",
            customerRef: "12345",
            idempotencyKey: "pay-1",
        }
    );

    assert.equal(t.category, "bill");
    assert.equal(t.billerId, billerId);
    assert.equal(t.toAccountNumber, billerAccount.accountNumber);
    assert.match(t.description ?? "", /Bharat Power/);

    const customerAccReread = env.repos.accounts.findById(fromAcc.id)!;
    assert.equal(customerAccReread.balanceMinor, 75_000);
    const billerAccReread = env.repos.accounts.findById(billerAccount.id)!;
    assert.equal(billerAccReread.balanceMinor, 25_000);

    // Repeat with same idempotency key returns the same transfer (no double-debit).
    const t2 = payBill(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: fromAcc.id,
            billerId,
            amountMinor: 25_000,
            currency: "INR",
            customerRef: "12345",
            idempotencyKey: "pay-1",
        }
    );
    assert.equal(t2.id, t.id);
    const finalBalance = env.repos.accounts.findById(fromAcc.id)!.balanceMinor;
    assert.equal(finalBalance, 75_000);
});

test("payBill rejects unknown / inactive billers", () => {
    const env = makeTestEnv();
    const { billerId } = bootBiller(env);
    env.repos.billers.setActive(billerId, false);

    const customer = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const fromAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        customer.id
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: fromAcc.id, amountMinor: 100_000, currency: "INR" }
    );

    assert.throws(
        () =>
            payBill(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: fromAcc.id,
                    billerId: "00000000-0000-4000-8000-deadbeef0001",
                    amountMinor: 1000,
                    currency: "INR",
                }
            ),
        BillerNotFoundError
    );
    assert.throws(
        () =>
            payBill(
                { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
                {
                    fromAccountId: fromAcc.id,
                    billerId,
                    amountMinor: 1000,
                    currency: "INR",
                }
            ),
        BillerInactiveError
    );
});
