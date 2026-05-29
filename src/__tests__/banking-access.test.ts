process.env.DATABASE_URL = ":memory:";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { migrate } from "../db/migrate";

migrate();

import app from "../app";
import { makeTestEnv, grantBankingAccess } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { submitKyc } from "../contexts/kyc/application/submitKyc";
import {
    assertBankingAccess,
    getBankingAccess,
} from "../contexts/kyc/application/bankingAccess";
import { KycBankingAccessDeniedError } from "../contexts/kyc/domain/errors";
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

test("getBankingAccess denies users without approved KYC", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "no-kyc"
    );
    createAccountForUser({ repo: env.repos.accounts, ids: env.ids, clock: env.clock }, user.id);

    const access = getBankingAccess(
        { kyc: env.repos.kyc, accounts: env.repos.accounts },
        user.id
    );
    assert.equal(access.kycApproved, false);
    assert.equal(access.activeAccountCount, 1);
    assert.equal(access.allowed, false);
});

test("getBankingAccess denies submitted KYC even with an active account", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "submitted-kyc"
    );
    createAccountForUser({ repo: env.repos.accounts, ids: env.ids, clock: env.clock }, user.id);
    submitKyc(
        { repo: env.repos.kyc, ids: env.ids, clock: env.clock },
        {
            userId: user.id,
            fullName: "Test",
            dob: "1990-01-15",
            pan: "ABCDE1234F",
            address: "Mumbai",
        }
    );

    assert.throws(
        () =>
            assertBankingAccess(
                { kyc: env.repos.kyc, accounts: env.repos.accounts },
                user.id
            ),
        (e) => e instanceof KycBankingAccessDeniedError
    );
});

test("getBankingAccess denies approved KYC without an active account", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "approved-no-account"
    );
    const acc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        user.id
    );
    grantBankingAccess(env, user.id);
    env.repos.accounts.update({ ...acc, status: "Closed", updatedAt: env.clock.now() });

    assert.throws(
        () =>
            assertBankingAccess(
                { kyc: env.repos.kyc, accounts: env.repos.accounts },
                user.id
            ),
        (e) =>
            e instanceof KycBankingAccessDeniedError &&
            /active account/i.test(e.message)
    );
});

test("assertBankingAccess passes for approved KYC with an active account", () => {
    const env = makeTestEnv();
    const user = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "approved-active"
    );
    createAccountForUser({ repo: env.repos.accounts, ids: env.ids, clock: env.clock }, user.id);
    grantBankingAccess(env, user.id);

    assert.doesNotThrow(() =>
        assertBankingAccess(
            { kyc: env.repos.kyc, accounts: env.repos.accounts },
            user.id
        )
    );
});

test("unverified customer gets 403 on banking APIs but can read KYC and accounts", async () => {
    _resetSessionStore();
    const { sessionId, key } = provisionSession();

    const username = `unverified-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
        const headers = { "x-session-id": sessionId };

        const kycRes = await fetch(`${server.url}/kyc/me`, { headers });
        assert.equal(kycRes.status, 200);

        const accountsRes = await fetch(`${server.url}/accounts/me`, { headers });
        assert.equal(accountsRes.status, 200);

        const limitsRes = await fetch(`${server.url}/transfer/limits`, { headers });
        assert.equal(limitsRes.status, 403);
        const limitsBody = decodeBody(await limitsRes.text(), sessionId, key) as {
            success: boolean;
            error: { message: string };
        };
        assert.equal(limitsBody.success, false);
        assert.match(limitsBody.error.message, /KYC|active account/i);

        const beneficiaryRes = await fetch(`${server.url}/beneficiaries`, {
            method: "POST",
            headers: {
                ...headers,
                "Content-Type": "application/json",
            },
            body: encryptedBody({ nickname: "Bob", accountNumber: "SBE-0000000001" }, sessionId, key),
        });
        assert.equal(beneficiaryRes.status, 403);
    } finally {
        await server.close();
        deleteSession(sessionId);
    }
});
