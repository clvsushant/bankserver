// Set the DB to in-memory BEFORE any imports that touch the singleton db
// client.
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
    deleteSession,
    _resetSessionStore,
} from "../crypto/sessionStore";
import { encryptAES, decryptAES } from "../crypto/aes";
import { container } from "../container";
import { signupUser } from "../contexts/identity/application/registerUser";
import { issueRecoveryCode } from "../contexts/identity/application/recoveryCodes";
import { peekLoginState } from "../contexts/identity/application/loginStateMachine";

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

test("POST /identity/login/recovery mints enroll-additional state on a valid code", async () => {
    _resetSessionStore();
    const { sessionId, key } = provisionSession();

    const username = `rec-ok-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const password = "Aa1!correcthorsebattery";
    const user = await signupUser(
        {
            userRepo: container.repos.users,
            ids: container.ids,
            clock: container.clock,
        },
        { username, email: `${username}@example.com`, password, role: "customer" }
    );

    const { code } = issueRecoveryCode(
        {
            repo: container.repos.recoveryCodes,
            users: container.repos.users,
            ids: container.ids,
            clock: container.clock,
            bus: container.bus,
        },
        { userId: user.id, adminUserId: user.id }
    );

    const server = await startServer();
    try {
        const res = await fetch(`${server.url}/identity/login/recovery`, {
            method: "POST",
            headers: {
                "x-session-id": sessionId,
                "content-type": "application/json",
            },
            body: encryptedBody({ username, password, code, sessionId }, sessionId, key),
        });
        assert.equal(res.status, 200);
        const body = decodeBody(await res.text(), sessionId, key) as {
            nextStep: string;
            username: string;
            nonce: string;
        };
        assert.equal(body.nextStep, "enroll-additional");
        assert.equal(body.username, username);
        assert.ok(body.nonce);

        const state = peekLoginState(sessionId, "enroll-additional");
        assert.ok(state, "server-side state must exist for the new nonce");
        assert.equal(state!.nonce, body.nonce);

        // passkeyEnrolled is unchanged: the user signed up but has no
        // credential yet, so we never mark it true here even on success.
        const reread = container.repos.users.findById(user.id)!;
        assert.equal(reread.passkeyEnrolled, false);
    } finally {
        await server.close();
        deleteSession(sessionId);
    }
});

test("POST /identity/login/recovery rejects a wrong code", async () => {
    _resetSessionStore();
    const { sessionId, key } = provisionSession();

    const username = `rec-bad-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const password = "Aa1!correcthorsebattery";
    const user = await signupUser(
        {
            userRepo: container.repos.users,
            ids: container.ids,
            clock: container.clock,
        },
        { username, email: `${username}@example.com`, password, role: "customer" }
    );
    issueRecoveryCode(
        {
            repo: container.repos.recoveryCodes,
            users: container.repos.users,
            ids: container.ids,
            clock: container.clock,
            bus: container.bus,
        },
        { userId: user.id, adminUserId: user.id }
    );

    const server = await startServer();
    try {
        const res = await fetch(`${server.url}/identity/login/recovery`, {
            method: "POST",
            headers: {
                "x-session-id": sessionId,
                "content-type": "application/json",
            },
            body: encryptedBody(
                { username, password, code: "ZZZZ-ZZZZ-ZZZZ", sessionId },
                sessionId,
                key
            ),
        });
        assert.equal(res.status, 403);
    } finally {
        await server.close();
        deleteSession(sessionId);
    }
});

test("POST /identity/login/recovery rejects a wrong password", async () => {
    _resetSessionStore();
    const { sessionId, key } = provisionSession();

    const username = `rec-bad-pw-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const password = "Aa1!correcthorsebattery";
    const user = await signupUser(
        {
            userRepo: container.repos.users,
            ids: container.ids,
            clock: container.clock,
        },
        { username, email: `${username}@example.com`, password, role: "customer" }
    );
    const { code } = issueRecoveryCode(
        {
            repo: container.repos.recoveryCodes,
            users: container.repos.users,
            ids: container.ids,
            clock: container.clock,
            bus: container.bus,
        },
        { userId: user.id, adminUserId: user.id }
    );

    const server = await startServer();
    try {
        const res = await fetch(`${server.url}/identity/login/recovery`, {
            method: "POST",
            headers: {
                "x-session-id": sessionId,
                "content-type": "application/json",
            },
            body: encryptedBody(
                { username, password: "totally-wrong", code, sessionId },
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
