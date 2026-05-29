import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { open } from "../contexts/accounts/domain/account";
import { placeHold, releaseHold, availableBalanceMinor } from "../contexts/accounts/domain/account";
import { HoldExceedsBalanceError } from "../contexts/accounts/domain/errors";

const at = new Date("2026-05-01T00:00:00Z");

test("placeHold reduces available balance", () => {
    const acc = open({
        id: "a-1",
        accountNumber: "SBE-0000000001",
        userId: "u-1",
        createdAt: at,
    });
    const funded = { ...acc, balanceMinor: 100_00 };
    const held = placeHold(funded, 30_00, at);
    assert.equal(held.holdBalanceMinor, 30_00);
    assert.equal(availableBalanceMinor(held), 70_00);
});

test("releaseHold restores available balance", () => {
    const acc = open({
        id: "a-1",
        accountNumber: "SBE-0000000001",
        userId: "u-1",
        createdAt: at,
    });
    const funded = { ...acc, balanceMinor: 100_00 };
    const held = placeHold(funded, 40_00, at);
    const released = releaseHold(held, 40_00, at);
    assert.equal(released.holdBalanceMinor, 0);
    assert.equal(availableBalanceMinor(released), 100_00);
});

test("hold cannot exceed balance", () => {
    const acc = open({
        id: "a-1",
        accountNumber: "SBE-0000000001",
        userId: "u-1",
        createdAt: at,
    });
    const funded = { ...acc, balanceMinor: 50_00 };
    assert.throws(
        () => placeHold(funded, 60_00, at),
        (e) => e instanceof HoldExceedsBalanceError
    );
});
