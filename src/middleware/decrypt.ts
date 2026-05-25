import { Request, Response, NextFunction } from "express";
import { decryptAES } from "../crypto/aes";
import { getSessionKey, recordNonce } from "../crypto/sessionStore";
import { isUuid } from "../utils/validate";
import { BadRequestError, UnauthorizedError } from "../utils/errors";
import logger from "../utils/logger";
import { redact } from "../utils/redact";

const TIMESTAMP_WINDOW_MS = 60 * 1000;
const MAX_PAYLOAD_LEN = 64 * 1024;

interface RequestEnvelope {
    data: unknown;
    nonce: string;
    timestamp: number;
}

function isEnvelope(value: unknown): value is RequestEnvelope {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.nonce === "string" &&
        v.nonce.length >= 16 &&
        v.nonce.length <= 128 &&
        typeof v.timestamp === "number" &&
        Number.isFinite(v.timestamp) &&
        "data" in v
    );
}

type DecryptedRequest = Request & { __requestDecrypted?: boolean };

export async function decryptMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        // Idempotent: if a previous mount's `decryptMiddleware` already
        // handled this request (sessionId set, body decrypted, request logged),
        // skip. Without this guard, a request that matches both a broad and a
        // narrow mount (e.g. `/identity` and `/identity/credentials`) would
        // try to decrypt an already-decrypted body and 400 with "Invalid
        // session" / "Invalid payload".
        if ((req as DecryptedRequest).__requestDecrypted) return next();
        (req as DecryptedRequest).__requestDecrypted = true;

        const headerSessionId = req.headers["x-session-id"];

        // GET / HEAD requests don't carry an encrypted body. We still
        // require the session header so the response can be encrypted, but
        // we skip nonce + envelope validation. Bodies remain validated for
        // POST / PUT / PATCH / DELETE.
        if (req.method === "GET" || req.method === "HEAD") {
            if (!isUuid(headerSessionId)) {
                return next(new BadRequestError("Invalid session"));
            }
            const key = getSessionKey(headerSessionId);
            if (!key) return next(new UnauthorizedError("Invalid session"));
            (req as Request & { sessionId?: string }).sessionId = headerSessionId;
            logger.info(`req ${req.method} ${req.originalUrl}`, {
                query: redact(req.query),
                params: redact(req.params),
            });
            return next();
        }

        const body = req.body && typeof req.body === "object" ? req.body : {};
        const bodySessionId = (body as Record<string, unknown>).sessionId;
        const payload = (body as Record<string, unknown>).payload;

        if (
            !isUuid(headerSessionId) ||
            !isUuid(bodySessionId) ||
            headerSessionId !== bodySessionId
        ) {
            return next(new BadRequestError("Invalid session"));
        }

        if (
            typeof payload !== "string" ||
            payload.length === 0 ||
            payload.length > MAX_PAYLOAD_LEN
        ) {
            return next(new BadRequestError("Invalid payload"));
        }

        const sessionId = headerSessionId;
        const key = getSessionKey(sessionId);
        if (!key) {
            return next(new UnauthorizedError("Invalid session"));
        }

        let envelope: unknown;
        try {
            envelope = decryptAES(payload, key, sessionId);
        } catch (cause) {
            logger.error("Decryption failed", cause);
            return next(new BadRequestError("Decryption failed"));
        }

        if (!isEnvelope(envelope)) {
            return next(new BadRequestError("Malformed envelope"));
        }

        const now = Date.now();
        if (Math.abs(now - envelope.timestamp) > TIMESTAMP_WINDOW_MS) {
            return next(new BadRequestError("Stale request"));
        }

        if (!recordNonce(sessionId, envelope.nonce, envelope.timestamp)) {
            return next(new BadRequestError("Replay detected"));
        }

        req.body = envelope.data;
        (req as Request & { sessionId?: string }).sessionId = sessionId;

        logger.info(`req ${req.method} ${req.originalUrl}`, {
            body: redact(envelope.data),
            query: redact(req.query),
            params: redact(req.params),
        });

        next();
    } catch (err) {
        next(err);
    }
}
