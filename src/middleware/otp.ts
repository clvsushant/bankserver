import { Request, Response, NextFunction } from "express";
import { consumeOtpToken } from "../services/otpTokens";
import { hashActionParams } from "../services/actionTokens";
import {
    BadRequestError,
    ForbiddenError,
    UnauthorizedError,
} from "../utils/errors";

/**
 * Returns a middleware that requires a valid one-shot OTP token whose
 * `paramsHash` matches the body and whose `sessionId` matches the request.
 *
 * Always chained BEFORE `requireStepUp(action)` for OTP-gated routes —
 * OTP and step-up are independent factors and must each be presented
 * fresh. Both verify against the same `(action, sessionId, paramsHash)`
 * triple so the two factors necessarily refer to the same authorized
 * request.
 */
export function requireOtp(action: string) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const headerToken = req.headers["x-otp-token"];
        if (typeof headerToken !== "string" || headerToken.length === 0) {
            return next(new UnauthorizedError("Missing OTP token"));
        }

        const sessionId = (req as Request & { sessionId?: string }).sessionId;
        if (!sessionId) {
            return next(new UnauthorizedError("No session for OTP token"));
        }

        const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
            string,
            unknown
        >;
        const paramsHash = hashActionParams(body);

        const result = consumeOtpToken(headerToken, {
            expectedAction: action,
            expectedSessionId: sessionId,
            expectedParamsHash: paramsHash,
        });

        if (!result.ok) {
            switch (result.reason) {
                case "malformed":
                    return next(new BadRequestError("Malformed OTP token"));
                case "expired":
                    return next(new ForbiddenError("OTP token expired"));
                case "consumed":
                    return next(new ForbiddenError("OTP token already used"));
                case "mismatch":
                    return next(new ForbiddenError("OTP token does not match request"));
            }
        }
        next();
    };
}
