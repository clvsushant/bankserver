import test from "node:test";
import assert from "node:assert/strict";
import {
    consumeLoginState,
    peekLoginState,
    setLoginState,
    _resetLoginStateMachine,
} from "../contexts/identity/application/loginStateMachine";

test("setLoginState returns a nonce and is readable", () => {
    _resetLoginStateMachine();
    const out = setLoginState("session-1", {
        userId: "u-1",
        username: "alice",
        purpose: "enroll-passkey",
    });
    assert.match(out.nonce, /^[A-Za-z0-9_-]{20,}$/);
    const peeked = peekLoginState("session-1", "enroll-passkey");
    assert.ok(peeked);
    assert.equal(peeked!.userId, "u-1");
});

test("peek with wrong purpose returns undefined", () => {
    _resetLoginStateMachine();
    setLoginState("session-1", {
        userId: "u-1",
        username: "alice",
        purpose: "enroll-passkey",
    });
    assert.equal(peekLoginState("session-1", "auth-passkey"), undefined);
});

test("consume removes the entry", () => {
    _resetLoginStateMachine();
    setLoginState("session-1", {
        userId: "u-1",
        username: "alice",
        purpose: "auth-passkey",
    });
    const taken = consumeLoginState("session-1", "auth-passkey");
    assert.ok(taken);
    assert.equal(peekLoginState("session-1", "auth-passkey"), undefined);
});

test("setLoginState rotates the nonce on re-entry", () => {
    _resetLoginStateMachine();
    const a = setLoginState("session-1", {
        userId: "u-1",
        username: "alice",
        purpose: "auth-passkey",
    });
    const b = setLoginState("session-1", {
        userId: "u-1",
        username: "alice",
        purpose: "auth-passkey",
    });
    assert.notEqual(a.nonce, b.nonce);
    const peeked = peekLoginState("session-1", "auth-passkey");
    assert.equal(peeked!.nonce, b.nonce);
});
