import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser, registerUser } from "../contexts/identity/application/registerUser";
import { UsernameTakenError } from "../contexts/identity/domain/errors";
import { bindUser, getBoundUser, setSessionKey, _resetSessionStore } from "../crypto/sessionStore";
import crypto from "crypto";

test("findOrCreateUser is idempotent", () => {
    const env = makeTestEnv();
    const a = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const b = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    assert.equal(a.id, b.id);
});

test("registerUser refuses to create twice", () => {
    const env = makeTestEnv();
    registerUser({ userRepo: env.repos.users, ids: env.ids, clock: env.clock }, "alice");
    assert.throws(
        () =>
            registerUser({ userRepo: env.repos.users, ids: env.ids, clock: env.clock }, "alice"),
        (e) => e instanceof UsernameTakenError
    );
});

test("bindUser persists the userId on the encrypted session", () => {
    _resetSessionStore();
    const sessionId = crypto.randomUUID();
    setSessionKey(sessionId, crypto.randomBytes(32));

    bindUser(sessionId, "user-1");
    assert.equal(getBoundUser(sessionId), "user-1");

    // Idempotent for the same userId
    bindUser(sessionId, "user-1");
    assert.equal(getBoundUser(sessionId), "user-1");

    // Refuses to rebind to a different userId
    assert.throws(() => bindUser(sessionId, "user-2"));
});
