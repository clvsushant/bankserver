import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { recordAudit } from "../contexts/audit/application/recordAudit";
import { listAudit } from "../contexts/audit/application/listAudit";
import { fromBusEvent } from "../contexts/audit/application/fromBusEvent";
import { AuditActions } from "../contexts/audit/domain/actions";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";

function deps(env: ReturnType<typeof makeTestEnv>) {
    return { repo: env.repos.audit, clock: env.clock, ids: env.ids };
}

test("recordAudit persists a single row with category derived from action", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const entry = recordAudit(deps(env), {
        action: AuditActions.TransferExecuted,
        actor: { userId: user.id, username: "alice", role: "customer" },
        target: { type: "account", id: "a1" },
        status: "success",
        summary: "Posted ₹100",
        payload: { amountMinor: 10000 },
    });
    assert.equal(entry.category, "money");
    assert.equal(entry.actorRole, "customer");
    assert.equal(entry.seq, 1);
    assert.ok(entry.hash.length === 64, "hash must be sha256 hex");
    assert.equal(entry.prevHash, undefined);

    const round = env.repos.audit.findById(entry.id);
    assert.ok(round);
    assert.equal(round!.action, "transfer.executed");
});

test("recordAudit redacts sensitive payload fields", () => {
    const env = makeTestEnv();
    const entry = recordAudit(deps(env), {
        action: AuditActions.AuthSignup,
        status: "success",
        summary: "signup",
        payload: { username: "bob", password: "Secret1!", pan: "ABCDE1234F" },
    });
    const payload = entry.payload as Record<string, unknown>;
    assert.equal(payload.password, "<redacted>");
    assert.notEqual(payload.pan, "ABCDE1234F", "PAN must be masked");
});

test("listAudit pages and filters", () => {
    const env = makeTestEnv();
    for (let i = 0; i < 30; i++) {
        const action = i % 2 === 0 ? AuditActions.TransferExecuted : AuditActions.KycApproved;
        recordAudit(deps(env), {
            action,
            status: "success",
            summary: `entry ${i}`,
        });
    }
    const all = listAudit({ repo: env.repos.audit }, { limit: 10, offset: 0 });
    assert.equal(all.entries.length, 10);
    assert.equal(all.total, 30);
    assert.equal(all.hasMore, true);

    const onlyMoney = listAudit(
        { repo: env.repos.audit },
        { category: "money", limit: 50, offset: 0 }
    );
    assert.equal(onlyMoney.total, 15);
    assert.ok(onlyMoney.entries.every((e) => e.category === "money"));

    const second = listAudit({ repo: env.repos.audit }, { limit: 10, offset: 10 });
    assert.equal(second.entries.length, 10);
    // Newest-first ordering: page 1 [29..20], page 2 [19..10]
    assert.ok(second.entries[0].seq < all.entries[all.entries.length - 1].seq);
});

test("fromBusEvent maps all known event types", () => {
    const cases = [
        { type: "KycSubmitted", expected: "kyc.submitted", target: "kyc_application" },
        { type: "KycApproved", expected: "kyc.approved", target: "kyc_application" },
        { type: "KycRejected", expected: "kyc.rejected", target: "kyc_application" },
        { type: "MoneyMoved", expected: "transfer.executed", target: "transfer" },
        { type: "BillPaid", expected: "bill.paid", target: "transfer" },
        { type: "AccountOpened", expected: "account.opened", target: "account" },
        { type: "AccountFrozen", expected: "account.frozen", target: "account" },
        { type: "AccountUnfrozen", expected: "account.unfrozen", target: "account" },
        { type: "AccountClosed", expected: "account.closed", target: "account" },
        { type: "BeneficiaryAdded", expected: "beneficiary.added", target: "beneficiary" },
        { type: "BeneficiaryRemoved", expected: "beneficiary.removed", target: "beneficiary" },
        {
            type: "StandingInstructionCreated",
            expected: "si.created",
            target: "standing_instruction",
        },
        {
            type: "StandingInstructionPaused",
            expected: "si.paused",
            target: "standing_instruction",
        },
        { type: "DebitCardIssued", expected: "card.issued", target: "debit_card" },
        { type: "DebitCardFrozen", expected: "card.frozen", target: "debit_card" },
        { type: "DebitCardCancelled", expected: "card.cancelled", target: "debit_card" },
        { type: "PasswordChanged", expected: "auth.password.changed", target: "user" },
        { type: "PasskeyRevoked", expected: "auth.passkey.revoked", target: "user" },
        {
            type: "PasskeyEnrolledAdditional",
            expected: "auth.passkey.enrolled.additional",
            target: "user",
        },
        {
            type: "RecoveryCodeIssued",
            expected: "admin.recovery.code.issued",
            target: "user",
        },
        {
            type: "RecoveryCodeConsumed",
            expected: "auth.recovery.consumed.success",
            target: "user",
        },
    ];
    const userTargetTypes = new Set([
        "PasswordChanged",
        "PasskeyRevoked",
        "PasskeyEnrolledAdditional",
        "RecoveryCodeIssued",
        "RecoveryCodeConsumed",
    ]);
    for (const c of cases) {
        const ev = {
            type: c.type,
            // Event payload — fromBusEvent picks the right key off it.
            applicationId: "obj1",
            transferId: "tr1",
            accountId: "obj1",
            beneficiaryId: "obj1",
            siId: "obj1",
            cardId: "obj1",
            userId: "u1",
            ownerUserId: "u1",
            amountMinor: 1000,
        } as { type: string };
        const r = fromBusEvent(ev);
        assert.ok(r, `mapper returned null for ${c.type}`);
        assert.equal(r!.action, c.expected);
        assert.equal(r!.target?.type, c.target);
        // Money-flow targets use the transfer id; auth/user targets use the
        // user id; everything else routes through `obj1` per its event field.
        const expectedId =
            c.type === "MoneyMoved" || c.type === "BillPaid"
                ? "tr1"
                : userTargetTypes.has(c.type)
                  ? "u1"
                  : "obj1";
        assert.equal(r!.target?.id, expectedId, `target id for ${c.type}`);
    }
});

test("fromBusEvent returns null for unknown types", () => {
    assert.equal(fromBusEvent({ type: "NeverEverSeenBefore" }), null);
});

test("auth.otp.* actions resolve to the auth category and round-trip through recordAudit", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const cases = [
        { action: AuditActions.AuthOtpRequested, expected: "auth.otp.requested" },
        { action: AuditActions.AuthOtpVerified, expected: "auth.otp.verified" },
        { action: AuditActions.AuthOtpFailed, expected: "auth.otp.failed" },
    ];
    for (const c of cases) {
        const e = recordAudit(deps(env), {
            action: c.action,
            actor: { userId: user.id, username: "alice", role: "customer" },
            target: { type: "user", id: user.id },
            status: c.action === AuditActions.AuthOtpFailed ? "failure" : "success",
            summary: `OTP ${c.action}`,
            payload: {
                action: "passkey.add",
                // Both should be redacted by the audit pipeline.
                otpCode: "123456",
                otpToken: "would.be.token",
            },
        });
        assert.equal(e.action, c.expected);
        assert.equal(e.category, "auth");
        const payload = e.payload as Record<string, unknown>;
        assert.equal(payload.otpCode, "<redacted>");
        assert.equal(payload.otpToken, "<redacted>");
    }
});
