import test from "node:test";
import assert from "node:assert/strict";
import {
    OTP_REQUIRED_ACTIONS,
    isOtpRequired,
    requestOtp,
    verifyOtp,
    _resetOtp,
} from "../services/otpService";
import {
    consumeOtpToken,
    mintOtpToken,
    _resetOtpTokens,
} from "../services/otpTokens";
import { hashActionParams } from "../services/actionTokens";

function reset() {
    _resetOtp();
    _resetOtpTokens();
    delete process.env.OTP_STUB_BYPASS;
}

test("OTP_REQUIRED_ACTIONS holds exactly the documented sensitive actions", () => {
    reset();
    assert.equal(OTP_REQUIRED_ACTIONS.size, 6);
    for (const a of [
        "passkey.add",
        "passkey.revoke",
        "password.change",
        "session.wipe",
        "identity.contact.change",
        "admin.recovery",
    ]) {
        assert.ok(isOtpRequired(a), `${a} should require OTP`);
    }
    assert.equal(isOtpRequired("transfer"), false);
});

test("requestOtp generates a 6-digit code with 5-minute TTL", () => {
    reset();
    const before = Date.now();
    const r = requestOtp({
        sessionId: "s1",
        action: "passkey.add",
        params: {},
        userId: "u1",
    });
    assert.match(r.code, /^[0-9]{6}$/);
    assert.ok(r.expiresAt - before >= 5 * 60 * 1000 - 1000);
    assert.ok(r.expiresAt - before <= 5 * 60 * 1000 + 1000);
});

test("verifyOtp accepts the right code exactly once and consumes the slot", () => {
    reset();
    const r = requestOtp({
        sessionId: "s1",
        action: "passkey.add",
        params: { foo: "bar" },
        userId: "u1",
    });
    const ok = verifyOtp({
        sessionId: "s1",
        action: "passkey.add",
        params: { foo: "bar" },
        code: r.code,
        userId: "u1",
    });
    assert.deepEqual(ok, { ok: true, userId: "u1" });

    const replay = verifyOtp({
        sessionId: "s1",
        action: "passkey.add",
        params: { foo: "bar" },
        code: r.code,
        userId: "u1",
    });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "missing");
});

test("verifyOtp rejects with mismatch on different params (different paramsHash)", () => {
    reset();
    const r = requestOtp({
        sessionId: "s1",
        action: "password.change",
        params: { oldPassword: "a", newPassword: "b" },
        userId: "u1",
    });
    const out = verifyOtp({
        sessionId: "s1",
        action: "password.change",
        params: { oldPassword: "a", newPassword: "DIFFERENT" },
        code: r.code,
        userId: "u1",
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "missing");
});

test("verifyOtp locks the slot after 5 wrong attempts", () => {
    reset();
    requestOtp({
        sessionId: "s1",
        action: "passkey.add",
        params: {},
        userId: "u1",
    });
    for (let i = 0; i < 5; i++) {
        const out = verifyOtp({
            sessionId: "s1",
            action: "passkey.add",
            params: {},
            code: "999999",
            userId: "u1",
        });
        assert.equal(out.ok, false);
    }
    const sixth = verifyOtp({
        sessionId: "s1",
        action: "passkey.add",
        params: {},
        code: "000000",
        userId: "u1",
    });
    assert.equal(sixth.ok, false);
    if (!sixth.ok) assert.equal(sixth.reason, "locked");
});

test("OTP_STUB_BYPASS=true accepts the literal 000000 alongside the real code", () => {
    reset();
    process.env.OTP_STUB_BYPASS = "true";
    requestOtp({
        sessionId: "s1",
        action: "passkey.add",
        params: {},
        userId: "u1",
    });
    const out = verifyOtp({
        sessionId: "s1",
        action: "passkey.add",
        params: {},
        code: "000000",
        userId: "u1",
    });
    assert.equal(out.ok, true);
});

test("OTP_STUB_BYPASS=true still requires a slot (no /request, no /verify)", () => {
    reset();
    process.env.OTP_STUB_BYPASS = "true";
    const out = verifyOtp({
        sessionId: "no-slot",
        action: "passkey.add",
        params: {},
        code: "000000",
        userId: "u1",
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "missing");
});

test("requestOtp resend cooldown returns the same code while live", () => {
    reset();
    const a = requestOtp({
        sessionId: "s1",
        action: "passkey.add",
        params: {},
        userId: "u1",
    });
    const b = requestOtp({
        sessionId: "s1",
        action: "passkey.add",
        params: {},
        userId: "u1",
    });
    assert.equal(b.code, a.code);
    assert.equal(b.requestId, a.requestId);
    assert.equal(b.resent, true);
});

test("OTP token mint/consume is bound to (action, sessionId, paramsHash) and single-use", () => {
    reset();
    const params = { x: 1 };
    const paramsHash = hashActionParams(params);
    const { token } = mintOtpToken({
        action: "passkey.add",
        sessionId: "s1",
        paramsHash,
    });
    const ok = consumeOtpToken(token, {
        expectedAction: "passkey.add",
        expectedSessionId: "s1",
        expectedParamsHash: paramsHash,
    });
    assert.equal(ok.ok, true);
    const replay = consumeOtpToken(token, {
        expectedAction: "passkey.add",
        expectedSessionId: "s1",
        expectedParamsHash: paramsHash,
    });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "consumed");
});

test("OTP token rejects mismatched action / sessionId / paramsHash", () => {
    reset();
    const { token } = mintOtpToken({
        action: "passkey.add",
        sessionId: "s1",
        paramsHash: "abc",
    });
    const wrongAction = consumeOtpToken(token, {
        expectedAction: "passkey.revoke",
        expectedSessionId: "s1",
        expectedParamsHash: "abc",
    });
    assert.equal(wrongAction.ok, false);
    if (!wrongAction.ok) assert.equal(wrongAction.reason, "mismatch");
});

test("malformed OTP token is rejected", () => {
    reset();
    const out = consumeOtpToken("not-a-token", {
        expectedAction: "passkey.add",
        expectedSessionId: "s1",
        expectedParamsHash: "abc",
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "malformed");
});
