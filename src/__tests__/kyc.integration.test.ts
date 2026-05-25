import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { submitKyc } from "../contexts/kyc/application/submitKyc";
import { approveKyc, rejectKyc } from "../contexts/kyc/application/decideKyc";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import type { KycApprovedEvent } from "../contexts/kyc/domain/events";
import { KycAlreadyExistsError } from "../contexts/kyc/domain/errors";
import { recordAudit } from "../contexts/audit/application/recordAudit";
import { fromBusEvent } from "../contexts/audit/application/fromBusEvent";

test("KycApproved event triggers account creation via the bus", () => {
    const env = makeTestEnv();
    env.bus.subscribe<KycApprovedEvent>("KycApproved", (e) => {
        createAccountForUser(
            { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
            e.userId
        );
    });

    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "admin",
        "admin"
    );

    const app = submitKyc(
        { repo: env.repos.kyc, ids: env.ids, clock: env.clock },
        {
            userId: user.id,
            fullName: "Alice",
            dob: "1990-01-15",
            pan: "ABCDE1234F",
            address: "Mumbai",
        }
    );
    assert.equal(app.status, "Submitted");

    const approved = approveKyc(
        { repo: env.repos.kyc, clock: env.clock, bus: env.bus },
        { applicationId: app.id, adminUserId: admin.id }
    );
    assert.equal(approved.status, "Approved");

    const accs = env.repos.accounts.listByUserId(user.id);
    assert.equal(accs.length, 1);
    assert.equal(accs[0].balanceMinor, 0);
    assert.equal(accs[0].status, "Active");
});

test("submitKyc rejects when an active application already exists", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const input = {
        userId: user.id,
        fullName: "Alice",
        dob: "1990-01-15",
        pan: "ABCDE1234F",
        address: "Mumbai",
    };
    submitKyc({ repo: env.repos.kyc, ids: env.ids, clock: env.clock }, input);
    assert.throws(
        () => submitKyc({ repo: env.repos.kyc, ids: env.ids, clock: env.clock }, input),
        (e) => e instanceof KycAlreadyExistsError
    );
});

test("rejected user can re-submit", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "admin",
        "admin"
    );

    const app = submitKyc(
        { repo: env.repos.kyc, ids: env.ids, clock: env.clock },
        {
            userId: user.id,
            fullName: "Alice",
            dob: "1990-01-15",
            pan: "ABCDE1234F",
            address: "Mumbai",
        }
    );
    rejectKyc(
        { repo: env.repos.kyc, clock: env.clock, bus: env.bus },
        { applicationId: app.id, adminUserId: admin.id, reason: "doc unclear" }
    );

    const second = submitKyc(
        { repo: env.repos.kyc, ids: env.ids, clock: env.clock },
        {
            userId: user.id,
            fullName: "Alice",
            dob: "1990-01-15",
            pan: "ABCDE1234F",
            address: "Mumbai",
        }
    );
    assert.equal(second.status, "Submitted");
});

test("KYC submit + approve flow writes audit rows when wired to the bus", () => {
    const env = makeTestEnv();
    env.bus.subscribeAll((event) => {
        const input = fromBusEvent(event);
        if (!input) return;
        recordAudit(
            { repo: env.repos.audit, clock: env.clock, ids: env.ids },
            input
        );
    });

    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "admin",
        "admin"
    );

    const app = submitKyc(
        { repo: env.repos.kyc, ids: env.ids, clock: env.clock, bus: env.bus },
        {
            userId: user.id,
            fullName: "Alice",
            dob: "1990-01-15",
            pan: "ABCDE1234F",
            address: "Mumbai",
        }
    );
    approveKyc(
        { repo: env.repos.kyc, clock: env.clock, bus: env.bus },
        { applicationId: app.id, adminUserId: admin.id }
    );

    const rows = env.repos.audit.list({ limit: 50, offset: 0 }).entries;
    const actions = rows.map((r) => r.action);
    assert.ok(actions.includes("kyc.submitted"), "kyc.submitted should be audited");
    assert.ok(actions.includes("kyc.approved"), "kyc.approved should be audited");
    const submitted = rows.find((r) => r.action === "kyc.submitted")!;
    assert.equal(submitted.targetType, "kyc_application");
    assert.equal(submitted.targetId, app.id);
});
