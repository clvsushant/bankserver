import { Request, Response, NextFunction } from "express";
import { getBoundUser } from "../crypto/sessionStore";
import { container } from "../container";
import { ForbiddenError, UnauthorizedError } from "../utils/errors";
import type { Role } from "../contexts/identity/domain/user";

/**
 * Augments req with the authenticated user (looked up via the userId bound
 * to the encrypted session by the passkey-login flow).
 *
 * Order: must run AFTER decryptMiddleware so `req.sessionId` is set. The
 * request remains rejected if no userId is bound — callers must complete
 * /identity/login before invoking authenticated endpoints.
 */
export function requireSession(req: Request, _res: Response, next: NextFunction) {
    const sessionId = (req as Request & { sessionId?: string }).sessionId;
    if (!sessionId) return next(new UnauthorizedError("Session required"));

    const userId = getBoundUser(sessionId);
    if (!userId) return next(new UnauthorizedError("Login required"));

    const user = container.repos.users.findById(userId);
    if (!user) return next(new UnauthorizedError("Login required"));

    (req as Request & { user?: { id: string; username: string; role: Role } }).user = {
        id: user.id,
        username: user.username,
        role: user.role,
    };
    next();
}

export function requireRole(role: Role) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const u = (req as Request & { user?: { role: Role } }).user;
        if (!u) return next(new UnauthorizedError("Login required"));
        if (u.role !== role) return next(new ForbiddenError("Insufficient role"));
        next();
    };
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            sessionId?: string;
            user?: { id: string; username: string; role: Role };
        }
    }
}
