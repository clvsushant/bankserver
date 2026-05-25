/**
 * Layer 6 (cont.): per-session, per-action velocity caps.
 *
 * In a real system this would be backed by Redis with sliding windows and
 * server-issued risk scores. For the demo we keep it in-memory with two
 * simple counters per (sessionId, action):
 *
 *   - count in the last minute  (max 5)
 *   - count in the last day     (max 50)
 *
 * The caller invokes recordAttempt(sessionId, action) before performing the
 * action; if it returns null the action is allowed, otherwise the returned
 * reason is surfaced as a 429 to the client.
 */

interface VelocityEntry {
    minute: { since: number; count: number };
    day: { since: number; count: number };
}

const PER_MINUTE_MAX = 5;
const PER_DAY_MAX = 50;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_KEYS = 10_000;

const buckets = new Map<string, VelocityEntry>();

function key(sessionId: string, action: string) {
    return `${sessionId}::${action}`;
}

function evictIfNeeded() {
    if (buckets.size <= MAX_KEYS) return;
    // simple LRU-ish eviction
    const drop = buckets.size - MAX_KEYS + 100;
    let i = 0;
    for (const k of buckets.keys()) {
        if (i++ >= drop) break;
        buckets.delete(k);
    }
}

export function recordAttempt(
    sessionId: string,
    action: string
): { allowed: true } | { allowed: false; reason: "minute" | "day"; retryAfterSec: number } {
    evictIfNeeded();
    const k = key(sessionId, action);
    const now = Date.now();
    const entry = buckets.get(k) ?? {
        minute: { since: now, count: 0 },
        day: { since: now, count: 0 },
    };

    if (now - entry.minute.since >= MINUTE_MS) {
        entry.minute = { since: now, count: 0 };
    }
    if (now - entry.day.since >= DAY_MS) {
        entry.day = { since: now, count: 0 };
    }

    if (entry.minute.count >= PER_MINUTE_MAX) {
        const retryAfterSec = Math.max(
            1,
            Math.ceil((entry.minute.since + MINUTE_MS - now) / 1000)
        );
        buckets.set(k, entry);
        return { allowed: false, reason: "minute", retryAfterSec };
    }
    if (entry.day.count >= PER_DAY_MAX) {
        const retryAfterSec = Math.max(1, Math.ceil((entry.day.since + DAY_MS - now) / 1000));
        buckets.set(k, entry);
        return { allowed: false, reason: "day", retryAfterSec };
    }

    entry.minute.count += 1;
    entry.day.count += 1;
    buckets.set(k, entry);
    return { allowed: true };
}

export function _resetVelocity(): void {
    buckets.clear();
}
