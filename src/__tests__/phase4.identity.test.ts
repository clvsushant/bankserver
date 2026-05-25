import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeTestEnv } from "./_setup";
import { signupUser } from "../contexts/identity/application/registerUser";
import { changePassword } from "../contexts/identity/application/changePassword";
import { verifyPassword } from "../contexts/identity/application/passwords";
import {
    _resetLoginStateMachine,
    consumeLoginState,
    peekLoginState,
    setLoginState,
} from "../contexts/identity/application/loginStateMachine";
import {
    InvalidCredentialsError,
    UnknownUserError,
    WeakPasswordError,
} from "../contexts/identity/domain/errors";

test("changePassword swaps the hash when old password verifies", async () => {
    const env = makeTestEnv();
    const u = await signupUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        {
            username: "alice",
            email: "alice@example.com",
            password: "Original-Pass123!",
            role: "customer",
        }
    );

    await changePassword(
        { userRepo: env.repos.users },
        { userId: u.id, oldPassword: "Original-Pass123!", newPassword: "Brand-New-Pass456!" }
    );
    const reread = env.repos.users.findById(u.id)!;
    assert.equal(await verifyPassword("Original-Pass123!", reread.passwordHash), false);
    assert.equal(await verifyPassword("Brand-New-Pass456!", reread.passwordHash), true);
});

test("changePassword rejects wrong old password / unknown user / weak new password", async () => {
    const env = makeTestEnv();
    const u = await signupUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        {
            username: "alice",
            email: "alice@example.com",
            password: "Original-Pass123!",
            role: "customer",
        }
    );

    await assert.rejects(
        () =>
            changePassword(
                { userRepo: env.repos.users },
                { userId: u.id, oldPassword: "wrong", newPassword: "Brand-New-Pass456!" }
            ),
        InvalidCredentialsError
    );
    await assert.rejects(
        () =>
            changePassword(
                { userRepo: env.repos.users },
                { userId: "missing", oldPassword: "x", newPassword: "Brand-New-Pass456!" }
            ),
        UnknownUserError
    );
    await assert.rejects(
        () =>
            changePassword(
                { userRepo: env.repos.users },
                { userId: u.id, oldPassword: "Original-Pass123!", newPassword: "weak" }
            ),
        WeakPasswordError
    );
    await assert.rejects(
        () =>
            changePassword(
                { userRepo: env.repos.users },
                {
                    userId: u.id,
                    oldPassword: "Original-Pass123!",
                    newPassword: "Original-Pass123!",
                }
            ),
        WeakPasswordError
    );
});

test("LoginPurpose enroll-additional: setLoginState + peek/consume round-trip", () => {
    _resetLoginStateMachine();
    const sessionId = crypto.randomUUID();
    const { nonce, expiresAt } = setLoginState(sessionId, {
        userId: "u1",
        username: "alice",
        purpose: "enroll-additional",
    });
    assert.ok(nonce);
    assert.ok(expiresAt > Date.now());

    // Wrong purpose returns undefined (the guard prevents
    // /webauthn/registration/* from running on a non-enroll state).
    assert.equal(peekLoginState(sessionId, "auth-passkey"), undefined);

    const peeked = peekLoginState(sessionId, "enroll-additional");
    assert.ok(peeked);
    assert.equal(peeked!.nonce, nonce);
    assert.equal(peeked!.purpose, "enroll-additional");

    // Consume removes the entry.
    const consumed = consumeLoginState(sessionId, "enroll-additional");
    assert.ok(consumed);
    assert.equal(
        consumeLoginState(sessionId, "enroll-additional"),
        undefined,
        "second consume must be empty"
    );
});
