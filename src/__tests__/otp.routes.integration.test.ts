process.env.DATABASE_URL = ":memory:";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { migrate } from "../db/migrate";

migrate();

import app from "../app";
import {
    setSessionKey,
    bindUser,
    deleteSession,
    _resetSessionStore,
} from "../crypto/sessionStore";
import { encryptAES, decryptAES } from "../crypto/aes";
import { container } from "../container";
import { signupUser } from "../contexts/identity/application/registerUser";
import { _resetOtp } from "../services/otpService";
import { _resetOtpTokens } from "../services/otpTokens";
import logger from "../utils/logger";

interface ServerHandle {
    close: () => Promise<void>;
    url: string;
}

function startServer(): Promise<ServerHandle> {
    return new Promise((resolve) => {
        const server = http.createServer(app);
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            const port = typeof addr === "object" && addr ? addr.port : 0;
            resolve({
                close: () =>
                    new Promise<void>((res) => {
                        server.close(() => res());
                    }),
                url: `http://127.0.0.1:${port}`,
            });
        });
    });
}

function provisionSession(): { sessionId: string; key: Buffer } {
    const sessionId = crypto.randomUUID();
    const key = crypto.randomBytes(32);
    setSessionKey(sessionId, key);
    return { sessionId, key };
}

function encryptedBody(data: unknown, sessionId: string, key: Buffer): string {
    const envelope = {
        data,
        nonce: crypto.randomBytes(16).toString("hex"),
        timestamp: Date.now(),
    };
    const { payload } = encryptAES(envelope, key, sessionId);
    return JSON.stringify({ sessionId, payload });
}

function decodeBody(raw: string, sessionId: string, key: Buffer): unknown {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && typeof parsed.payload === "string") {
        const env = decryptAES(parsed.payload, key, sessionId) as { data: unknown };
        return env.data;
    }
    return parsed;
}

/** Capture the next stub-delivered OTP code from logger.info output. */
function captureNextStubCode(): { promise: Promise<string>; restore: () => void } {
    const original = logger.info;
    let resolveCode!: (code: string) => void;
    const promise = new Promise<string>((r) => (resolveCode = r));
    (logger as { info: typeof logger.info }).info = (
        message: string,
        data?: unknown
    ) => {
        const m = /\bcode=(\d{6})\b/.exec(message);
        if (m) resolveCode(m[1]!);
        original(message, data);
    };
    return {
        promise,
        restore: () => {
            (logger as { info: typeof logger.info }).info = original;
        },
    };
}

test("OTP request → verify mints an otpToken; protected endpoint accepts it", async () => {
    _resetSessionStore();
    _resetOtp();
    _resetOtpTokens();
    const { sessionId, key } = provisionSession();

    const username = `otp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const password = "Aa1!correcthorsebattery";
    const user = await signupUser(
        {
            userRepo: container.repos.users,
            ids: container.ids,
            clock: container.clock,
        },
        { username, email: `${username}@example.com`, password, role: "customer" }
    );
    bindUser(sessionId, user.id);

    const cap = captureNextStubCode();
    const server = await startServer();
    try {
        // /request — drives the stub which logs the code we capture.
        const reqRes = await fetch(`${server.url}/identity/otp/request`, {
            method: "POST",
            headers: {
                "x-session-id": sessionId,
                "content-type": "application/json",
            },
            body: encryptedBody(
                { action: "password.change", params: { oldPassword: "x", newPassword: "y" } },
                sessionId,
                key
            ),
        });
        assert.equal(reqRes.status, 200);
        const reqBody = decodeBody(await reqRes.text(), sessionId, key) as {
            requestId: string;
            deliveredVia: string;
        };
        assert.equal(reqBody.deliveredVia, "stub");
        assert.ok(reqBody.requestId);

        const code = await cap.promise;

        // /verify with wrong code — failure case.
        const badRes = await fetch(`${server.url}/identity/otp/verify`, {
            method: "POST",
            headers: {
                "x-session-id": sessionId,
                "content-type": "application/json",
            },
            body: encryptedBody(
                {
                    action: "password.change",
                    params: { oldPassword: "x", newPassword: "y" },
                    code: "999999",
                },
                sessionId,
                key
            ),
        });
        assert.equal(badRes.status, 403);

        // /verify with the right code — mints token.
        const okRes = await fetch(`${server.url}/identity/otp/verify`, {
            method: "POST",
            headers: {
                "x-session-id": sessionId,
                "content-type": "application/json",
            },
            body: encryptedBody(
                {
                    action: "password.change",
                    params: { oldPassword: "x", newPassword: "y" },
                    code,
                },
                sessionId,
                key
            ),
        });
        assert.equal(okRes.status, 200);
        const okBody = decodeBody(await okRes.text(), sessionId, key) as {
            otpToken: string;
            expiresAt: number;
        };
        assert.ok(okBody.otpToken);
        assert.ok(okBody.expiresAt > Date.now());
    } finally {
        cap.restore();
        await server.close();
        deleteSession(sessionId);
    }
});

test("password.change without x-otp-token is rejected (additive guard)", async () => {
    _resetSessionStore();
    _resetOtp();
    _resetOtpTokens();
    const { sessionId, key } = provisionSession();

    const username = `otp-pw-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const password = "Aa1!correcthorsebattery";
    const user = await signupUser(
        {
            userRepo: container.repos.users,
            ids: container.ids,
            clock: container.clock,
        },
        { username, email: `${username}@example.com`, password, role: "customer" }
    );
    bindUser(sessionId, user.id);

    const server = await startServer();
    try {
        // No x-otp-token, no x-action-token — must fail at the OTP gate
        // (which runs BEFORE step-up).
        const res = await fetch(`${server.url}/identity/password/change`, {
            method: "POST",
            headers: {
                "x-session-id": sessionId,
                "content-type": "application/json",
            },
            body: encryptedBody(
                { oldPassword: password, newPassword: "Bb2@anothersafepass" },
                sessionId,
                key
            ),
        });
        assert.equal(res.status, 401);
    } finally {
        await server.close();
        deleteSession(sessionId);
    }
});

test("/identity/otp/request rejects an action that isn't OTP-gated", async () => {
    _resetSessionStore();
    _resetOtp();
    _resetOtpTokens();
    const { sessionId, key } = provisionSession();

    const username = `otp-bad-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const password = "Aa1!correcthorsebattery";
    const user = await signupUser(
        {
            userRepo: container.repos.users,
            ids: container.ids,
            clock: container.clock,
        },
        { username, email: `${username}@example.com`, password, role: "customer" }
    );
    bindUser(sessionId, user.id);

    const server = await startServer();
    try {
        const res = await fetch(`${server.url}/identity/otp/request`, {
            method: "POST",
            headers: {
                "x-session-id": sessionId,
                "content-type": "application/json",
            },
            body: encryptedBody({ action: "transfer", params: {} }, sessionId, key),
        });
        assert.equal(res.status, 400);
    } finally {
        await server.close();
        deleteSession(sessionId);
    }
});
