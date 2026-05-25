import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { emitNotification } from "../contexts/notifications/application/createNotification";

test("emit + listByUser + countUnread + markRead / markAllRead", () => {
    const env = makeTestEnv();
    const u = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const deps = {
        repo: env.repos.notifications,
        ids: env.ids,
        clock: env.clock,
    };
    const a = emitNotification(deps, {
        userId: u.id,
        kind: "transfer.sent",
        title: "Sent ₹500",
        body: "to bob",
    });
    env.clock.advance(1000);
    const b = emitNotification(deps, {
        userId: u.id,
        kind: "kyc.approved",
        title: "KYC approved",
        body: "Welcome",
    });

    assert.equal(env.repos.notifications.countUnread(u.id), 2);
    const all = env.repos.notifications.listByUser(u.id, { limit: 10 });
    // Expect newest first.
    assert.equal(all[0]!.id, b.id);
    assert.equal(all[1]!.id, a.id);

    env.repos.notifications.markRead(a.id, env.clock.now());
    assert.equal(env.repos.notifications.countUnread(u.id), 1);

    env.repos.notifications.markAllRead(u.id, env.clock.now());
    assert.equal(env.repos.notifications.countUnread(u.id), 0);
    const unread = env.repos.notifications.listByUser(u.id, { unreadOnly: true });
    assert.equal(unread.length, 0);
});

test("notifications are scoped per user", () => {
    const env = makeTestEnv();
    const a = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const b = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "bob"
    );
    const deps = {
        repo: env.repos.notifications,
        ids: env.ids,
        clock: env.clock,
    };
    emitNotification(deps, { userId: a.id, kind: "transfer.sent", title: "A", body: "" });
    emitNotification(deps, { userId: b.id, kind: "transfer.received", title: "B", body: "" });

    assert.equal(env.repos.notifications.countUnread(a.id), 1);
    assert.equal(env.repos.notifications.countUnread(b.id), 1);
    assert.equal(env.repos.notifications.listByUser(a.id).length, 1);
});
