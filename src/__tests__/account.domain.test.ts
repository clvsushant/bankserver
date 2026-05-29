import test from "node:test";
import assert from "node:assert/strict";
import { close, credit, debit, freeze, open, unfreeze } from "../contexts/accounts/domain/account";
import {
    AccountCloseRequiresZeroBalanceError,
    AccountInvalidStatusTransitionError,
    AccountNotActiveError,
    InsufficientAvailableFundsError,
    MinimumBalanceViolationError,
} from "../contexts/accounts/domain/errors";

const at = new Date("2026-05-01T00:00:00Z");

function makeAcc() {
    return open({ id: "a-1", accountNumber: "SBE-0000000001", userId: "u-1", createdAt: at });
}

test("open creates an Active account with 0 balance", () => {
    const a = makeAcc();
    assert.equal(a.status, "Active");
    assert.equal(a.balanceMinor, 0);
    assert.equal(a.currency, "INR");
});

test("freeze blocks debit/credit", () => {
    const a = freeze(makeAcc(), at);
    assert.equal(a.status, "Frozen");
    assert.throws(() => debit(a, 100, "INR", at), (e) => e instanceof AccountNotActiveError);
    assert.throws(() => credit(a, 100, "INR", at), (e) => e instanceof AccountNotActiveError);
});

test("unfreeze restores Active and allows credit", () => {
    const f = freeze(makeAcc(), at);
    const a = unfreeze(f, at);
    assert.equal(a.status, "Active");
    const c = credit(a, 100, "INR", at);
    assert.equal(c.balanceMinor, 100);
});

test("debit underflow throws InsufficientAvailableFundsError", () => {
    const a = makeAcc();
    assert.throws(
        () => debit(a, 1, "INR", at),
        (e) => e instanceof InsufficientAvailableFundsError
    );
});

test("close requires balance=0", () => {
    const a = credit(makeAcc(), 100_000, "INR", at);
    assert.throws(
        () => close(a, at),
        (e) => e instanceof AccountCloseRequiresZeroBalanceError
    );
    const zeroed = { ...a, balanceMinor: 0, holdBalanceMinor: 0 };
    const closed = close(zeroed, at);
    assert.equal(closed.status, "Closed");
});

test("freeze on Closed throws", () => {
    const a = close(makeAcc(), at);
    assert.throws(() => freeze(a, at), (e) => e instanceof AccountInvalidStatusTransitionError);
});
