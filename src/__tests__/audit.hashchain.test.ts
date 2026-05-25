import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import {
    canonicalize,
    hashEntry,
    recordAudit,
} from "../contexts/audit/application/recordAudit";
import { AuditActions } from "../contexts/audit/domain/actions";
import { sqlite as _unused_sqlite } from "../db/client";
import { auditLog } from "../db/schema";
import { eq } from "drizzle-orm";

void _unused_sqlite;

function deps(env: ReturnType<typeof makeTestEnv>) {
    return { repo: env.repos.audit, clock: env.clock, ids: env.ids };
}

function verifyChain(
    env: ReturnType<typeof makeTestEnv>
): { ok: true; count: number } | { ok: false; brokenAtId: string; reason: string } {
    const all = env.repos.audit.listAllChronological();
    let prevHash: string | undefined = undefined;
    for (const entry of all) {
        if ((entry.prevHash ?? undefined) !== prevHash) {
            return { ok: false, brokenAtId: entry.id, reason: "prev_hash mismatch" };
        }
        const expected = hashEntry({ ...entry, hash: "" });
        if (expected !== entry.hash) {
            return { ok: false, brokenAtId: entry.id, reason: "hash mismatch" };
        }
        prevHash = entry.hash;
    }
    return { ok: true, count: all.length };
}

test("clean DB verifies as intact", () => {
    const env = makeTestEnv();
    for (let i = 0; i < 5; i++) {
        recordAudit(deps(env), {
            action: AuditActions.TransferExecuted,
            status: "success",
            summary: `t${i}`,
            payload: { i },
        });
    }
    const r = verifyChain(env);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.count, 5);
});

test("each entry's prev_hash equals the previous row's hash", () => {
    const env = makeTestEnv();
    const a = recordAudit(deps(env), {
        action: AuditActions.AuthSignup,
        status: "success",
        summary: "first",
    });
    const b = recordAudit(deps(env), {
        action: AuditActions.AuthLoginSuccess,
        status: "success",
        summary: "second",
    });
    assert.equal(a.prevHash, undefined);
    assert.equal(b.prevHash, a.hash);
});

test("tampering with a stored summary breaks the chain", () => {
    const env = makeTestEnv();
    const a = recordAudit(deps(env), {
        action: AuditActions.AuthSignup,
        status: "success",
        summary: "first",
    });
    recordAudit(deps(env), {
        action: AuditActions.AuthLoginSuccess,
        status: "success",
        summary: "second",
    });

    // Mutate the first row's summary out-of-band — the hash will no longer
    // match the canonicalised content, so verify must report it.
    env.db.update(auditLog).set({ summary: "TAMPERED" }).where(eq(auditLog.id, a.id)).run();

    const r = verifyChain(env);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "hash mismatch");
});

test("canonicalize is deterministic and includes prevHash", () => {
    const env = makeTestEnv();
    const a = recordAudit(deps(env), {
        action: AuditActions.TransferExecuted,
        status: "success",
        summary: "x",
    });
    const round = env.repos.audit.findById(a.id)!;
    assert.equal(canonicalize(a), canonicalize(round));
    assert.ok(canonicalize(a).includes(`"prevHash":null`));
});
