import express from "express";
import { container } from "../../../container";
import { isUuid } from "../../../utils/validate";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../../utils/errors";
import { getMonthlyStatement } from "../application/getMonthlyStatement";
import { statementToCsv } from "../application/exportCsv";

export const statementsRouter = express.Router();

statementsRouter.get("/:accountId", (req, res, next) => {
    try {
        const user = req.user!;
        const { accountId } = req.params;
        const month = (req.query.month as string | undefined) ?? defaultMonth();

        if (!isUuid(accountId)) return next(new BadRequestError("Invalid accountId"));
        if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
            return next(new BadRequestError("Invalid month (expected YYYY-MM)"));

        const acc = container.repos.accounts.findById(accountId);
        if (!acc) return next(new NotFoundError("Account not found"));
        if (acc.userId !== user.id && user.role !== "admin")
            return next(new ForbiddenError("Cannot view this account's statement"));

        const stmt = getMonthlyStatement(container.db, { accountId, month });
        res.json({ statement: stmt });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /statements/:accountId/csv?month=YYYY-MM
 *
 * Returns a JSON envelope `{ filename, csv }` so the encrypted-response
 * middleware can wrap the text payload uniformly. The browser turns it
 * into a Blob client-side.
 */
statementsRouter.get("/:accountId/csv", (req, res, next) => {
    try {
        const user = req.user!;
        const { accountId } = req.params;
        const month = (req.query.month as string | undefined) ?? defaultMonth();

        if (!isUuid(accountId)) return next(new BadRequestError("Invalid accountId"));
        if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
            return next(new BadRequestError("Invalid month (expected YYYY-MM)"));

        const acc = container.repos.accounts.findById(accountId);
        if (!acc) return next(new NotFoundError("Account not found"));
        if (acc.userId !== user.id && user.role !== "admin")
            return next(new ForbiddenError("Cannot view this account's statement"));

        const stmt = getMonthlyStatement(container.db, { accountId, month });
        const csv = statementToCsv({ statement: stmt, accountNumber: acc.accountNumber });
        const filename = `statement-${acc.accountNumber}-${month}.csv`;
        res.json({ filename, csv });
    } catch (err) {
        next(err);
    }
});

function defaultMonth(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
