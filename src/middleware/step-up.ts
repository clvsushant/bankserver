import { Request, Response, NextFunction } from "express";
import { consumeActionToken, hashActionParams } from "../services/actionTokens";
import { recordAttempt } from "../services/velocity";
import {
    BadRequestError,
    ForbiddenError,
    TooManyRequestsError,
    UnauthorizedError,
} from "../utils/errors";

/**
 * Returns a middleware that requires a valid one-shot action token whose
 * `paramsHash` matches the body and whose `sessionId` matches the request.
 *
 * Combined with WebAuthn (Layer 5) this means: even if XSS replays a
 * captured encrypted /transfer request, it has no token. Even if XSS
 * forges a request, it can't produce a token because token issuance
 * requires a fresh user gesture (WebAuthn assertion).
 */
export function requireStepUp(action: string) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const headerToken = req.headers["x-action-token"];
        if (typeof headerToken !== "string" || headerToken.length === 0) {
            return next(new UnauthorizedError("Missing action token"));
        }

        const sessionId = (req as Request & { sessionId?: string }).sessionId;
        if (!sessionId) {
            return next(new UnauthorizedError("No session for action token"));
        }

        const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
            string,
            unknown
        >;
        // The token is bound to the *decrypted* params the client showed the
        // user when they approved. The client and server must canonicalize
        // the same way (we use JSON.stringify of the unencrypted payload
        // body received from decryptMiddleware).
        const paramsHash = hashActionParams(body);

        const result = consumeActionToken(headerToken, {
            expectedAction: action,
            expectedSessionId: sessionId,
            expectedParamsHash: paramsHash,
        });

        if (!result.ok) {
            switch (result.reason) {
                case "malformed":
                    return next(new BadRequestError("Malformed action token"));
                case "expired":
                    return next(new ForbiddenError("Action token expired"));
                case "consumed":
                    return next(new ForbiddenError("Action token already used"));
                case "mismatch":
                    return next(new ForbiddenError("Action token does not match request"));
            }
        }

        const velocity = recordAttempt(sessionId, action);
        if (!velocity.allowed) {
            return next(
                new TooManyRequestsError(
                    `Velocity cap (${velocity.reason}) reached`,
                    velocity.retryAfterSec
                )
            );
        }

        next();
    };
}
