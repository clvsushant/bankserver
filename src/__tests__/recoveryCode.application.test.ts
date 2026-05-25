import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import {
    consumeRecoveryCode,
    issueRecoveryCode,
} from "../contexts/identity/application/recoveryCodes";

function deps(env: ReturnType<typeof makeTestEnv>) {
    return {
        repo: env.repos.recoveryCodes,
        users: env.repos.users,
        ids: env.ids,
        clock: env.clock,
        bus: env.bus,
    };
}

test("issueRecoveryCode mints a 14-char dashed code and bcrypts it", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "rootadmin"
    );

    const { code, record } = issueRecoveryCode(deps(env), {
        userId: user.id,
        adminUserId: admin.id,
    });

    // XXXX-XXXX-XXXX (12 chars + 2 dashes).
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.notEqual(record.codeHash, code, "stored hash must NOT equal plaintext");
    assert.match(record.codeHash, /^\$2[aby]\$/, "must be a bcrypt hash");
    assert.equal(record.purpose, "passkey-add");
    assert.equal(record.userId, user.id);
    assert.equal(
        record.expiresAt.getTime() - record.issuedAt.getTime(),
        24 * 60 * 60 * 1000
    );
});

test("consumeRecoveryCode redeems a fresh code exactly once", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "rootadmin"
    );
    const { code } = issueRecoveryCode(deps(env), {
        userId: user.id,
        adminUserId: admin.id,
    });

    const ok = consumeRecoveryCode(
        { repo: env.repos.recoveryCodes, clock: env.clock, bus: env.bus },
        { userId: user.id, code }
    );
    assert.ok(ok, "first consume must succeed");
    assert.ok(ok!.consumedAt, "consumedAt must be set on the returned record");

    const second = consumeRecoveryCode(
        { repo: env.repos.recoveryCodes, clock: env.clock, bus: env.bus },
        { userId: user.id, code }
    );
    assert.equal(second, null, "second consume must fail (single-use)");
});

test("consumeRecoveryCode rejects a wrong code", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "rootadmin"
    );
    issueRecoveryCode(deps(env), { userId: user.id, adminUserId: admin.id });

    const r = consumeRecoveryCode(
        { repo: env.repos.recoveryCodes, clock: env.clock, bus: env.bus },
        { userId: user.id, code: "WRONG-CODE-NOPE" }
    );
    assert.equal(r, null);
});

test("consumeRecoveryCode rejects an expired code", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "rootadmin"
    );
    const { code } = issueRecoveryCode(deps(env), {
        userId: user.id,
        adminUserId: admin.id,
    });

    // Advance past 24h.
    env.clock.advance(25 * 60 * 60 * 1000);

    const r = consumeRecoveryCode(
        { repo: env.repos.recoveryCodes, clock: env.clock, bus: env.bus },
        { userId: user.id, code }
    );
    assert.equal(r, null, "expired code must not be redeemable");
});

test("consumeRecoveryCode never matches another user's code", () => {
    const env = makeTestEnv();
    const alice = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const bob = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "bob"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "rootadmin"
    );
    const { code } = issueRecoveryCode(deps(env), {
        userId: alice.id,
        adminUserId: admin.id,
    });

    const wrongUser = consumeRecoveryCode(
        { repo: env.repos.recoveryCodes, clock: env.clock, bus: env.bus },
        { userId: bob.id, code }
    );
    assert.equal(wrongUser, null, "code is scoped to the issued user");
});

test("consumeRecoveryCode is constant-time-ish when no codes exist", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    // No issue: still returns null without throwing.
    const r = consumeRecoveryCode(
        { repo: env.repos.recoveryCodes, clock: env.clock, bus: env.bus },
        { userId: user.id, code: "ABCD-EFGH-JKLM" }
    );
    assert.equal(r, null);
});

test("issueRecoveryCode publishes a RecoveryCodeIssued bus event", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "rootadmin"
    );
    const seen: Array<{ type: string }> = [];
    env.bus.subscribeAll((e) => seen.push(e));

    issueRecoveryCode(deps(env), { userId: user.id, adminUserId: admin.id });

    assert.equal(
        seen.filter((e) => e.type === "RecoveryCodeIssued").length,
        1
    );
});

test("consumeRecoveryCode publishes a RecoveryCodeConsumed bus event on hit", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "rootadmin"
    );
    const { code } = issueRecoveryCode(deps(env), {
        userId: user.id,
        adminUserId: admin.id,
    });
    const seen: Array<{ type: string }> = [];
    env.bus.subscribeAll((e) => seen.push(e));

    consumeRecoveryCode(
        { repo: env.repos.recoveryCodes, clock: env.clock, bus: env.bus },
        { userId: user.id, code }
    );

    assert.equal(
        seen.filter((e) => e.type === "RecoveryCodeConsumed").length,
        1
    );
});
