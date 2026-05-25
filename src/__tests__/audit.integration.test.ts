import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { recordAudit } from "../contexts/audit/application/recordAudit";
import { fromBusEvent } from "../contexts/audit/application/fromBusEvent";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { submitKyc } from "../contexts/kyc/application/submitKyc";
import { approveKyc } from "../contexts/kyc/application/decideKyc";
import { addBeneficiary } from "../contexts/beneficiaries/application/manageBeneficiary";
import { createAccountForUser, openAdditionalAccount } from "../contexts/accounts/application/createAccount";
import { freezeAccount } from "../contexts/accounts/application/freezeAccount";

/**
 * Wires the wildcard audit subscriber on a test env's bus. Mirrors what
 * production does in container.ts, but scoped to one test instance.
 */
function wireAudit(env: ReturnType<typeof makeTestEnv>) {
    env.bus.subscribeAll((event) => {
        const input = fromBusEvent(event);
        if (!input) return;
        recordAudit(
            { repo: env.repos.audit, clock: env.clock, ids: env.ids },
            input
        );
    });
}

test("bus.publish flows through the wildcard subscriber to the audit log", () => {
    const env = makeTestEnv();
    wireAudit(env);

    env.bus.publish([
        {
            type: "MoneyMoved",
            transferId: "t1",
            amountMinor: 5000,
            currency: "INR",
            postedAt: env.clock.now(),
        } as { type: string },
    ]);
    const page = env.repos.audit.list({ limit: 50, offset: 0 });
    assert.equal(page.total, 1);
    assert.equal(page.entries[0].action, "transfer.executed");
    assert.equal(page.entries[0].targetType, "transfer");
    assert.equal(page.entries[0].targetId, "t1");
});

test("kyc submit + approve produces audit rows for both events", () => {
    const env = makeTestEnv();
    wireAudit(env);

    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "rootadmin",
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

    const actions = env.repos.audit
        .list({ limit: 50, offset: 0 })
        .entries.map((e) => e.action);
    assert.ok(actions.includes("kyc.submitted"));
    assert.ok(actions.includes("kyc.approved"));
});

test("addBeneficiary publishes BeneficiaryAdded which lands in audit", () => {
    const env = makeTestEnv();
    wireAudit(env);

    const owner = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const target = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "bob"
    );
    // Open an account for bob so beneficiary lookup works.
    const targetAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock, bus: env.bus },
        target.id
    );

    addBeneficiary(
        {
            repo: env.repos.beneficiaries,
            accounts: env.repos.accounts,
            users: env.repos.users,
            ids: env.ids,
            clock: env.clock,
            bus: env.bus,
        },
        { ownerUserId: owner.id, nickname: "Bob (rent)", accountNumber: targetAcc.accountNumber }
    );

    const audited = env.repos.audit.list({ limit: 50, offset: 0 }).entries.map((e) => e.action);
    assert.ok(audited.includes("beneficiary.added"));
});

test("account freeze publishes AccountFrozen which lands in audit", () => {
    const env = makeTestEnv();
    wireAudit(env);

    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const acc = openAdditionalAccount(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock, bus: env.bus },
        { userId: user.id, accountType: "savings" }
    );

    freezeAccount(
        { repo: env.repos.accounts, clock: env.clock, bus: env.bus },
        { accountId: acc.id }
    );

    const actions = env.repos.audit.list({ limit: 50, offset: 0 }).entries.map((e) => e.action);
    assert.ok(actions.includes("account.opened"));
    assert.ok(actions.includes("account.frozen"));
});

test("wildcard subscriber survives an unknown event type", () => {
    const env = makeTestEnv();
    wireAudit(env);

    env.bus.publish([{ type: "ThisEventIsNotMapped" } as { type: string }]);
    const page = env.repos.audit.list({ limit: 10, offset: 0 });
    assert.equal(page.total, 0);
});
