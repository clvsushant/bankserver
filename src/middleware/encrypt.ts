import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { encryptAES } from "../crypto/aes";
import { getSessionKey } from "../crypto/sessionStore";
import { getContext } from "../utils/context-storage";
import logger from "../utils/logger";
import { redact } from "../utils/redact";

/**
 * Patches res.json so that any subsequent payload (including ones produced
 * by the global error handler) is wrapped in an authenticated envelope and
 * encrypted with the session's AES key. The session id is bound as AAD.
 *
 * Falls back to plaintext only if no session id is associated with the
 * request (i.e. the request never made it through decryptMiddleware).
 */
type PatchedResponse = Response & { __responseEncryptionPatched?: boolean };

export function encryptedResponse(req: Request, res: Response, next: NextFunction) {
    // Idempotent: if another `encryptedResponse` has already patched this
    // response, skip. This happens when a request matches both a broader
    // mount and a narrower one (e.g. `/identity` and `/identity/credentials`),
    // and re-patching would double-encrypt the body so the client only sees
    // the inner ciphertext as `{ payload: "..." }`.
    if ((res as PatchedResponse).__responseEncryptionPatched) return next();
    (res as PatchedResponse).__responseEncryptionPatched = true;

    const originalJson = res.json.bind(res);

    res.json = function (data: unknown) {
        try {
            const sessionId =
                (req as Request & { sessionId?: string }).sessionId ||
                (typeof req.headers["x-session-id"] === "string"
                    ? (req.headers["x-session-id"] as string)
                    : undefined);

            const isError =
                data && typeof data === "object" && (data as { success?: unknown }).success === false;

            logger.info(
                `res ${req.method} ${req.originalUrl} -> ${res.statusCode}${
                    isError ? " [error]" : ""
                }`,
                { body: redact(data) }
            );

            if (!sessionId) return originalJson(data);

            const key = getSessionKey(sessionId);
            if (!key) return originalJson(data);

            const envelope = {
                data,
                nonce: crypto.randomBytes(16).toString("hex"),
                timestamp: Date.now(),
            };

            const encrypted = encryptAES(envelope, key, sessionId);
            return originalJson(encrypted);
        } catch (err) {
            logger.error("Response encryption failed.", err);
            // Do NOT leak the unencrypted body if encryption fails. Surface
            // the requestId so the client can correlate this with logs.
            const requestId = getContext()?.requestId || "unknown";
            return originalJson({
                success: false,
                error: { message: "Response encryption failed", requestId },
            });
        }
    } as Response["json"];

    next();
}
