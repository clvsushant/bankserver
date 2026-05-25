import test from "node:test";
import assert from "node:assert/strict";
import { approve, reject, submit } from "../contexts/kyc/domain/kycApplication";
import { KycInvalidPanError, KycInvalidTransitionError } from "../contexts/kyc/domain/errors";

const baseInput = {
    id: "k-1",
    userId: "u-1",
    fullName: " Alice ",
    dob: "1990-01-15",
    pan: "abcde1234f",
    address: "  221B Baker St  ",
    submittedAt: new Date("2026-05-01T00:00:00Z"),
};

test("submit normalizes and validates input", () => {
    const a = submit(baseInput);
    assert.equal(a.fullName, "Alice");
    assert.equal(a.pan, "ABCDE1234F");
    assert.equal(a.address, "221B Baker St");
    assert.equal(a.status, "Submitted");
});

test("submit rejects invalid PAN", () => {
    assert.throws(
        () => submit({ ...baseInput, pan: "BADPAN" }),
        (e) => e instanceof KycInvalidPanError
    );
});

test("submit rejects invalid DOB format", () => {
    assert.throws(() => submit({ ...baseInput, dob: "1990/01/15" }));
});

test("approve transitions Submitted -> Approved exactly once", () => {
    const a = submit(baseInput);
    const decisionAt = new Date("2026-05-02T00:00:00Z");
    const approved = approve(a, { adminUserId: "admin-1", at: decisionAt });
    assert.equal(approved.status, "Approved");
    assert.equal(approved.decidedByUserId, "admin-1");
    assert.deepEqual(approved.decidedAt, decisionAt);
    assert.throws(
        () => approve(approved, { adminUserId: "admin-1", at: decisionAt }),
        (e) => e instanceof KycInvalidTransitionError
    );
});

test("reject requires non-empty reason", () => {
    const a = submit(baseInput);
    assert.throws(() =>
        reject(a, { adminUserId: "admin-1", at: new Date(), reason: "  " })
    );
});

test("rejected cannot be approved", () => {
    const a = submit(baseInput);
    const r = reject(a, {
        adminUserId: "admin-1",
        at: new Date(),
        reason: "doc unreadable",
    });
    assert.throws(() =>
        approve(r, { adminUserId: "admin-1", at: new Date() })
    );
});
