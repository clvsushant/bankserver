import crypto from "crypto";

/**
 * Stores pending ECDH handshakes (replaces the old rsaStore). Each entry
 * holds the server's ephemeral private key + a salt that will be re-fed
 * into HKDF on the handshake step. Like the RSA store before it, entries
 * are consumed atomically on a successful handshake — a leaked sessionId
 * cannot re-bind a session.
 */

const HANDSHAKE_TTL_MS = 5 * 60 * 1000;
const MAX_HANDSHAKES = 1_000;

interface HandshakeEntry {
    privateKey: crypto.KeyObject;
    salt: Buffer;
    createdAt: number;
}

const pending = new Map<string, HandshakeEntry>();

function evictOldest() {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [id, entry] of pending) {
        if (entry.createdAt < oldestTime) {
            oldestTime = entry.createdAt;
            oldestKey = id;
        }
    }
    if (oldestKey) pending.delete(oldestKey);
}

export function setHandshake(
    sessionId: string,
    privateKey: crypto.KeyObject,
    salt: Buffer
): void {
    if (pending.size >= MAX_HANDSHAKES) evictOldest();
    pending.set(sessionId, { privateKey, salt, createdAt: Date.now() });
}

export function consumeHandshake(sessionId: string): HandshakeEntry | undefined {
    const entry = pending.get(sessionId);
    if (!entry) return undefined;
    pending.delete(sessionId);
    if (Date.now() - entry.createdAt > HANDSHAKE_TTL_MS) return undefined;
    return entry;
}

const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of pending) {
        if (now - entry.createdAt > HANDSHAKE_TTL_MS) pending.delete(id);
    }
}, 60_000);
cleanup.unref();

export function _resetHandshakeStore(): void {
    pending.clear();
}
