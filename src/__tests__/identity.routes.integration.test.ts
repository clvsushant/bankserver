// Set the DB to in-memory BEFORE any imports that touch the singleton db
// client. (Both `app` and `container` reach `db/client.ts` at import time.)
process.env.DATABASE_URL = ":memory:";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { migrate } from "../db/migrate";

// Tables must exist before the route handlers run their first query.
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

test("GET /identity/me without a bound user returns 401 (encrypted)", async () => {
    _resetSessionStore();
    const { sessionId, key } = provisionSession();
    const server = await startServer();
    try {
        const res = await fetch(`${server.url}/identity/me`, {
            headers: { "x-session-id": sessionId },
        });
        assert.equal(res.status, 401);
        const body = decodeBody(await res.text(), sessionId, key) as {
            success: boolean;
            error: { message: string };
        };
        assert.equal(body.success, false);
        assert.match(body.error.message, /Login required|Session/);
    } finally {
        await server.close();
        deleteSession(sessionId);
    }
});

test("GET /identity/me returns 200 with the bound user", async () => {
    _resetSessionStore();
    const { sessionId, key } = provisionSession();

    const username = `me-ok-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const user = await signupUser(
        {
            userRepo: container.repos.users,
            ids: container.ids,
            clock: container.clock,
        },
        {
            username,
            email: `${username}@example.com`,
            password: "Aa1!correcthorsebattery",
            role: "customer",
        }
    );
    bindUser(sessionId, user.id);

    const server = await startServer();
    try {
        const res = await fetch(`${server.url}/identity/me`, {
            headers: { "x-session-id": sessionId },
        });
        assert.equal(res.status, 200);
        const body = decodeBody(await res.text(), sessionId, key) as {
            user: { id: string; username: string; role: string };
        };
        assert.equal(body.user.id, user.id);
        assert.equal(body.user.username, username);
        assert.equal(body.user.role, "customer");
    } finally {
        await server.close();
        deleteSession(sessionId);
    }
});

test("POST /identity/login/password is reachable through decryptMiddleware", async () => {
    _resetSessionStore();
    const { sessionId, key } = provisionSession();

    const username = `loginpw-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await signupUser(
        {
            userRepo: container.repos.users,
            ids: container.ids,
            clock: container.clock,
        },
        {
            username,
            email: `${username}@example.com`,
            password: "Aa1!correcthorsebattery",
            role: "customer",
        }
    );

    const server = await startServer();
    try {
        const res = await fetch(`${server.url}/identity/login/password`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-session-id": sessionId,
            },
            body: encryptedBody(
                { username, password: "Aa1!correcthorsebattery", sessionId },
                sessionId,
                key
            ),
        });
        assert.equal(res.status, 200);
        const body = decodeBody(await res.text(), sessionId, key) as {
            nextStep: string;
            username: string;
            nonce: string;
        };
        assert.equal(body.username, username);
        // No passkey enrolled yet => server steers user into enrollment.
        assert.equal(body.nextStep, "enroll");
        assert.equal(typeof body.nonce, "string");
        assert.ok(body.nonce.length > 0);
    } finally {
        await server.close();
        deleteSession(sessionId);
    }
});

test("POST /identity/logout drops the bound user AND the session", async () => {
    _resetSessionStore();
    const { sessionId, key } = provisionSession();

    const username = `logout-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const user = await signupUser(
        {
            userRepo: container.repos.users,
            ids: container.ids,
            clock: container.clock,
        },
        {
            username,
            email: `${username}@example.com`,
            password: "Aa1!correcthorsebattery",
            role: "customer",
        }
    );
    bindUser(sessionId, user.id);

    const server = await startServer();
    try {
        const ok = await fetch(`${server.url}/identity/logout`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-session-id": sessionId,
            },
            body: encryptedBody({}, sessionId, key),
        });
        assert.equal(ok.status, 200);

        // Subsequent /me on the SAME sessionId must fail — the encrypted
        // session is gone, so the decrypt middleware rejects with 401.
        const after = await fetch(`${server.url}/identity/me`, {
            headers: { "x-session-id": sessionId },
        });
        assert.equal(after.status, 401);
    } finally {
        await server.close();
    }
});
