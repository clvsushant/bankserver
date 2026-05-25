import test from "node:test";
import assert from "node:assert/strict";
import {
    AUDIT_ACTION_VALUES,
    AuditActions,
    categoryOf,
} from "../contexts/audit/domain/actions";

test("AuditActions registry has unique non-empty values", () => {
    const seen = new Set<string>();
    for (const v of AUDIT_ACTION_VALUES) {
        assert.equal(typeof v, "string");
        assert.ok(v.length > 0, "action must be non-empty");
        assert.ok(!seen.has(v), `duplicate action ${v}`);
        seen.add(v);
    }
});

test("categoryOf maps every action to a sensible category", () => {
    const cases: Array<[keyof typeof AuditActions, string]> = [
        ["AuthLoginSuccess", "auth"],
        ["AuthLoginFailure", "auth"],
        ["AuthSignup", "auth"],
        ["TransferExecuted", "money"],
        ["FaucetCredited", "money"],
        ["BillPaid", "bill"],
        ["KycSubmitted", "kyc"],
        ["KycApproved", "kyc"],
        ["AccountOpened", "account"],
        ["AccountFrozen", "account"],
        ["BeneficiaryAdded", "beneficiary"],
        ["StandingInstructionCreated", "si"],
        ["CardIssued", "card"],
        ["AdminKycListed", "admin.read"],
        ["AdminAuditExported", "admin.read"],
        ["AdminAuditVerified", "admin.read"],
        ["AdminUserLocked", "admin.write"],
        ["AdminFaucetIssued", "admin.write"],
    ];
    for (const [k, expected] of cases) {
        assert.equal(categoryOf(AuditActions[k]), expected, `for ${k}`);
    }
});
