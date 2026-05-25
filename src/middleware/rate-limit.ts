import { Request, Response, NextFunction } from "express";
import { TooManyRequestsError } from "../utils/errors";

interface Bucket {
    count: number;
    resetAt: number;
}

interface RateLimitOptions {
    windowMs: number;
    max: number;
}

// Registry of every limiter's bucket map so tests can reset them between cases.
const allBuckets: Set<Map<string, Bucket>> = new Set();

export function rateLimit({ windowMs, max }: RateLimitOptions) {
    const buckets = new Map<string, Bucket>();
    allBuckets.add(buckets);

    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [key, bucket] of buckets) {
            if (now >= bucket.resetAt) buckets.delete(key);
        }
    }, windowMs);
    sweep.unref();

    return (req: Request, _res: Response, next: NextFunction) => {
        const key = req.ip || req.socket.remoteAddress || "unknown";
        const now = Date.now();

        let bucket = buckets.get(key);
        if (!bucket || now >= bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }

        bucket.count += 1;
        if (bucket.count > max) {
            const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
            return next(new TooManyRequestsError("Too many requests", retryAfterSec));
        }

        next();
    };
}

export function _resetRateLimits(): void {
    for (const m of allBuckets) m.clear();
}
