const SESSION_IDLE_TTL_MS = 15 * 60 * 1000;
const SESSION_HARD_TTL_MS = 60 * 60 * 1000;
const NONCE_WINDOW_MS = 60 * 1000;
const MAX_SESSIONS = 10_000;
const MAX_NONCES_PER_SESSION = 10_000;

interface SessionEntry {
    key: Buffer;
    createdAt: number;
    lastUsedAt: number;
    seenNonces: Map<string, number>;
    userId?: string;
}

const sessions = new Map<string, SessionEntry>();

function isExpired(entry: SessionEntry, now: number): boolean {
    return (
        now - entry.lastUsedAt > SESSION_IDLE_TTL_MS || now - entry.createdAt > SESSION_HARD_TTL_MS
    );
}

function evictOldest() {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [id, entry] of sessions) {
        if (entry.lastUsedAt < oldestTime) {
            oldestTime = entry.lastUsedAt;
            oldestKey = id;
        }
    }
    if (oldestKey) deleteSession(oldestKey);
}

export class SessionConflictError extends Error {
    constructor() {
        super("Session already bound");
        this.name = "SessionConflictError";
    }
}

export function setSessionKey(sessionId: string, key: Buffer): void {
    if (sessions.has(sessionId)) {
        throw new SessionConflictError();
    }
    if (sessions.size >= MAX_SESSIONS) {
        evictOldest();
    }
    const now = Date.now();
    sessions.set(sessionId, {
        key,
        createdAt: now,
        lastUsedAt: now,
        seenNonces: new Map(),
    });
}

export function hasSession(sessionId: string): boolean {
    const entry = sessions.get(sessionId);
    if (!entry) return false;
    if (isExpired(entry, Date.now())) {
        deleteSession(sessionId);
        return false;
    }
    return true;
}

export function getSessionKey(sessionId: string): Buffer | undefined {
    const entry = sessions.get(sessionId);
    if (!entry) return undefined;
    const now = Date.now();
    if (isExpired(entry, now)) {
        deleteSession(sessionId);
        return undefined;
    }
    entry.lastUsedAt = now;
    return entry.key;
}

/**
 * Records a nonce as seen for the session. Returns false if the nonce was
 * already seen, the session does not exist, or the per-session nonce cap is
 * reached. Old nonces (outside the timestamp window) are pruned on every call.
 */
export function recordNonce(sessionId: string, nonce: string, timestamp: number): boolean {
    const entry = sessions.get(sessionId);
    if (!entry) return false;

    const now = Date.now();
    for (const [n, ts] of entry.seenNonces) {
        if (now - ts > NONCE_WINDOW_MS) entry.seenNonces.delete(n);
    }

    if (entry.seenNonces.has(nonce)) return false;
    if (entry.seenNonces.size >= MAX_NONCES_PER_SESSION) return false;

    entry.seenNonces.set(nonce, timestamp);
    return true;
}

/**
 * Bind a verified userId to the encrypted session. Called after a
 * successful passkey login so subsequent encrypted requests can recover
 * the caller's identity via `getBoundUser()`. Idempotent for the same
 * userId; throws on attempts to rebind to a different user (defense
 * against session-fixation by an XSS that observes a sessionId).
 */
export function bindUser(sessionId: string, userId: string): void {
    const entry = sessions.get(sessionId);
    if (!entry) throw new Error("Unknown session");
    if (isExpired(entry, Date.now())) {
        deleteSession(sessionId);
        throw new Error("Unknown session");
    }
    if (entry.userId && entry.userId !== userId) {
        throw new Error("Session already bound to a different user");
    }
    entry.userId = userId;
}

export function getBoundUser(sessionId: string): string | undefined {
    const entry = sessions.get(sessionId);
    if (!entry) return undefined;
    if (isExpired(entry, Date.now())) {
        deleteSession(sessionId);
        return undefined;
    }
    return entry.userId;
}

/**
 * Phase 4 #1 — list all sessions currently bound to a user. Returns the
 * sessionId + freshness metadata so the settings UI can show "Other
 * devices" entries and offer to revoke them.
 */
export interface UserSessionInfo {
    sessionId: string;
    createdAt: number;
    lastUsedAt: number;
}

export function listSessionsByUser(userId: string): UserSessionInfo[] {
    const out: UserSessionInfo[] = [];
    const now = Date.now();
    for (const [id, entry] of sessions) {
        if (entry.userId !== userId) continue;
        if (isExpired(entry, now)) continue;
        out.push({ sessionId: id, createdAt: entry.createdAt, lastUsedAt: entry.lastUsedAt });
    }
    return out;
}

/**
 * Phase 4 #1 — drop every session bound to a user EXCEPT the one passed in
 * (the caller's current session). Returns the count of sessions wiped.
 */
export function deleteSessionsByUser(userId: string, exceptSessionId?: string): number {
    let count = 0;
    for (const [id, entry] of sessions) {
        if (entry.userId !== userId) continue;
        if (id === exceptSessionId) continue;
        deleteSession(id);
        count += 1;
    }
    return count;
}

export function deleteSession(sessionId: string): void {
    const entry = sessions.get(sessionId);
    if (!entry) return;
    // Best-effort key zeroization; the JS runtime may keep copies elsewhere.
    entry.key.fill(0);
    entry.seenNonces.clear();
    sessions.delete(sessionId);
}

const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessions) {
        if (isExpired(entry, now)) deleteSession(id);
    }
}, 60_000);
cleanup.unref();

// Test helpers (not part of the public surface).
export function _resetSessionStore(): void {
    for (const id of [...sessions.keys()]) deleteSession(id);
}

export function _sessionCount(): number {
    return sessions.size;
}
