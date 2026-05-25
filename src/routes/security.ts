import express from "express";
import crypto from "crypto";
import { generateEcdhKeyPair, deriveAesKey } from "../crypto/ecdh";
import { setHandshake, consumeHandshake } from "../crypto/handshakeStore";
import { setSessionKey, hasSession, SessionConflictError } from "../crypto/sessionStore";
import { rateLimit } from "../middleware/rate-limit";
import { isUuid } from "../utils/validate";
import { BadRequestError, ConflictError } from "../utils/errors";

const router = express.Router();

const sessionRateLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const handshakeRateLimiter = rateLimit({ windowMs: 60_000, max: 20 });

/**
 * Layer 3: ECDH key-agreement handshake.
 *
 *   1) Client    GET  /security/session
 *      Server   ◄---  { sessionId, serverPublicJwk, salt }
 *
 *   2) Client    POST /security/handshake { sessionId, clientPublicJwk }
 *      Server   ◄---  { success: true }
 *      Both sides have now derived the same 32-byte AES-256-GCM key locally.
 *      The key bytes never travel on the wire.
 */

router.get("/session", sessionRateLimiter, async (req, res, next) => {
    try {
        const sessionId = crypto.randomUUID();
        const { publicJwk, privateKey } = await generateEcdhKeyPair();
        const salt = crypto.randomBytes(16);

        setHandshake(sessionId, privateKey, salt);

        res.status(200).json({
            sessionId,
            serverPublicJwk: publicJwk,
            salt: salt.toString("base64"),
        });
    } catch (err) {
        next(err);
    }
});

router.post("/handshake", handshakeRateLimiter, (req, res, next) => {
    try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const sessionId = (body as Record<string, unknown>).sessionId;
        const clientPublicJwk = (body as Record<string, unknown>).clientPublicJwk;

        if (!isUuid(sessionId)) {
            return next(new BadRequestError("Invalid session"));
        }
        if (
            !clientPublicJwk ||
            typeof clientPublicJwk !== "object" ||
            (clientPublicJwk as JsonWebKey).kty !== "EC" ||
            (clientPublicJwk as JsonWebKey).crv !== "P-256" ||
            typeof (clientPublicJwk as JsonWebKey).x !== "string" ||
            typeof (clientPublicJwk as JsonWebKey).y !== "string"
        ) {
            return next(new BadRequestError("Invalid client public key"));
        }
        if (hasSession(sessionId)) {
            return next(new ConflictError("Session already bound"));
        }

        const entry = consumeHandshake(sessionId);
        if (!entry) {
            return next(new BadRequestError("Invalid session"));
        }

        let aesKey: Buffer;
        try {
            aesKey = deriveAesKey(entry.privateKey, clientPublicJwk as JsonWebKey, entry.salt);
        } catch {
            return next(new BadRequestError("Invalid handshake"));
        }

        try {
            setSessionKey(sessionId, aesKey);
        } catch (err) {
            aesKey.fill(0);
            if (err instanceof SessionConflictError) {
                return next(new ConflictError("Session already bound"));
            }
            return next(err);
        }

        res.status(200).json({ success: true });
    } catch (err) {
        next(err);
    }
});

export default router;
