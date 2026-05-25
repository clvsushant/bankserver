import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { signupUser } from "../contexts/identity/application/registerUser";
import { loginWithPassword } from "../contexts/identity/application/login";
import { hashPassword, validateStrength } from "../contexts/identity/application/passwords";
import {
    AccountLockedError,
    InvalidCredentialsError,
    UsernameTakenError,
    WeakPasswordError,
    InvalidEmailError,
} from "../contexts/identity/domain/errors";

test("validateStrength accepts strong, rejects weak", () => {
    assert.equal(validateStrength("Aa1!aaaaaa").ok, true);
    assert.equal(validateStrength("aaaaaaaaaa").ok, false); // no upper/digit/symbol
    assert.equal(validateStrength("Short1!").ok, false); // too short
    assert.equal(validateStrength("AlphaOnly!").ok, false); // no digit
});

test("hashPassword produces verifiable bcrypt hash", async () => {
    const hash = await hashPassword("Aa1!correcthorsebattery");
    assert.match(hash, /^\$2[aby]\$\d{2}\$.{53}$/);
});

test("signupUser creates user with bcrypt-hashed password", async () => {
    const env = makeTestEnv();
    const u = await signupUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        { username: "alice", email: "alice@example.com", password: "Aa1!correcthorse" }
    );
    assert.equal(u.username, "alice");
    assert.match(u.passwordHash, /^\$2[aby]\$\d{2}\$.{53}$/);
    assert.equal(u.passkeyEnrolled, false);
    assert.equal(u.role, "customer");
});

test("signupUser rejects duplicate username", async () => {
    const env = makeTestEnv();
    await signupUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        { username: "alice", email: "alice@example.com", password: "Aa1!correcthorse" }
    );
    await assert.rejects(
        () =>
            signupUser(
                { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
                { username: "alice", email: "x@example.com", password: "Aa1!correcthorse" }
            ),
        (e) => e instanceof UsernameTakenError
    );
});

test("signupUser rejects bad email and weak password", async () => {
    const env = makeTestEnv();
    await assert.rejects(
        () =>
            signupUser(
                { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
                { username: "alice", email: "not-an-email", password: "Aa1!correcthorse" }
            ),
        (e) => e instanceof InvalidEmailError
    );
    await assert.rejects(
        () =>
            signupUser(
                { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
                { username: "alice", email: "alice@example.com", password: "weak" }
            ),
        (e) => e instanceof WeakPasswordError
    );
});

test("loginWithPassword returns nextStep=enroll on first login", async () => {
    const env = makeTestEnv();
    await signupUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        { username: "alice", email: "alice@example.com", password: "Aa1!correcthorse" }
    );
    const r = await loginWithPassword(
        { userRepo: env.repos.users, clock: env.clock },
        { username: "alice", password: "Aa1!correcthorse" }
    );
    assert.equal(r.nextStep, "enroll");
    assert.equal(r.user.username, "alice");
});

test("loginWithPassword returns nextStep=auth after passkey enrollment", async () => {
    const env = makeTestEnv();
    const u = await signupUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        { username: "alice", email: "alice@example.com", password: "Aa1!correcthorse" }
    );
    env.repos.users.markPasskeyEnrolled(u.id);

    const r = await loginWithPassword(
        { userRepo: env.repos.users, clock: env.clock },
        { username: "alice", password: "Aa1!correcthorse" }
    );
    assert.equal(r.nextStep, "auth");
});

test("loginWithPassword rejects invalid credentials", async () => {
    const env = makeTestEnv();
    await signupUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        { username: "alice", email: "alice@example.com", password: "Aa1!correcthorse" }
    );
    await assert.rejects(
        () =>
            loginWithPassword(
                { userRepo: env.repos.users, clock: env.clock },
                { username: "alice", password: "wrong" }
            ),
        (e) => e instanceof InvalidCredentialsError
    );
});

test("loginWithPassword does not leak user existence", async () => {
    const env = makeTestEnv();
    await assert.rejects(
        () =>
            loginWithPassword(
                { userRepo: env.repos.users, clock: env.clock },
                { username: "ghost", password: "Aa1!correcthorse" }
            ),
        (e) => e instanceof InvalidCredentialsError
    );
});

test("loginWithPassword locks account after 5 misses for 15 minutes", async () => {
    const env = makeTestEnv();
    await signupUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        { username: "alice", email: "alice@example.com", password: "Aa1!correcthorse" }
    );
    for (let i = 0; i < 5; i++) {
        await assert.rejects(() =>
            loginWithPassword(
                { userRepo: env.repos.users, clock: env.clock },
                { username: "alice", password: "wrong" }
            )
        );
    }
    // Even with the right password, user is now locked.
    await assert.rejects(
        () =>
            loginWithPassword(
                { userRepo: env.repos.users, clock: env.clock },
                { username: "alice", password: "Aa1!correcthorse" }
            ),
        (e) => e instanceof AccountLockedError
    );

    // After 15 minutes the lockout window passes — but the failed-counter
    // still trips a fresh lockout on next miss, which is fine.
    env.clock.advance(16 * 60 * 1000);
    const r = await loginWithPassword(
        { userRepo: env.repos.users, clock: env.clock },
        { username: "alice", password: "Aa1!correcthorse" }
    );
    assert.equal(r.user.username, "alice");
});

test("admin unlock via setAccountStatus(Active) clears the lockout", async () => {
    const env = makeTestEnv();
    const u = await signupUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        { username: "alice", email: "alice@example.com", password: "Aa1!correcthorse" }
    );
    env.repos.users.setAccountStatus(u.id, "Locked");
    await assert.rejects(
        () =>
            loginWithPassword(
                { userRepo: env.repos.users, clock: env.clock },
                { username: "alice", password: "Aa1!correcthorse" }
            ),
        (e) => e instanceof AccountLockedError
    );
    env.repos.users.setAccountStatus(u.id, "Active");
    const r = await loginWithPassword(
        { userRepo: env.repos.users, clock: env.clock },
        { username: "alice", password: "Aa1!correcthorse" }
    );
    assert.equal(r.user.username, "alice");
});
