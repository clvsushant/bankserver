import { Request, Response, NextFunction } from "express";
import { container } from "../container";
import { assertBankingAccess } from "../contexts/kyc/application/bankingAccess";
import { KycBankingAccessDeniedError } from "../contexts/kyc/domain/errors";
import { ForbiddenError, UnauthorizedError } from "../utils/errors";

/**
 * Requires approved KYC and at least one Active account before banking APIs.
 * Must run after requireSession.
 */
export function requireBankingAccess(req: Request, _res: Response, next: NextFunction) {
    const user = (req as Request & { user?: { id: string } }).user;
    if (!user) return next(new UnauthorizedError("Login required"));

    try {
        assertBankingAccess(
            { kyc: container.repos.kyc, accounts: container.repos.accounts },
            user.id
        );
        next();
    } catch (err) {
        if (err instanceof KycBankingAccessDeniedError)
            return next(new ForbiddenError(err.message));
        next(err);
    }
}
