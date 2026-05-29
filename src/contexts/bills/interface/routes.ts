import express from "express";
import { container } from "../../../container";
import { isNonEmptyString, isUuid } from "../../../utils/validate";
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    HttpError,
    NotFoundError,
} from "../../../utils/errors";
import { requireStepUp } from "../../../middleware/step-up";
import { auditMiddleware } from "../../audit/interface/middleware";
import { AuditActions } from "../../audit/domain/actions";
import { payBill } from "../application/payBill";
import { BillerInactiveError, BillerNotFoundError } from "../domain/errors";
import {
    AccountNotActiveError,
    AccountNotFoundError,
    CurrencyMismatchError,
    InsufficientFundsError,
} from "../../accounts/domain/errors";
import {
    TransferAmountInvalidError,
    TransferOverLimitError,
} from "../../payments/domain/errors";

export const billsRouter = express.Router();

billsRouter.get("/billers", (_req, res, next) => {
    try {
        const list = container.repos.billers.listActive();
        res.json({
            billers: list.map((b) => ({
                id: b.id,
                name: b.name,
                category: b.category,
                billerAccountNumber: b.billerAccountNumber,
                active: b.active,
            })),
        });
    } catch (err) {
        next(err);
    }
});

billsRouter.post(
    "/payments/bill",
    requireStepUp("bill.pay"),
    auditMiddleware(AuditActions.BillPaid),
    (req, res, next) => {
    try {
        const user = req.user!;
        const body = (req.body || {}) as Record<string, unknown>;
        const fromAccountId = body.fromAccountId as unknown;
        const billerId = body.billerId as unknown;
        const amountMinor = body.amountMinor as unknown;
        const customerRef = body.customerRef as unknown;
        const idempotencyKey = body.idempotencyKey as unknown;

        if (!isUuid(fromAccountId))
            return next(new BadRequestError("Invalid fromAccountId"));
        if (!isUuid(billerId)) return next(new BadRequestError("Invalid billerId"));
        if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor <= 0)
            return next(new BadRequestError("Invalid amountMinor"));
        if (
            customerRef !== undefined &&
            customerRef !== null &&
            (typeof customerRef !== "string" || customerRef.length > 64)
        )
            return next(new BadRequestError("Invalid customerRef"));
        if (
            idempotencyKey !== undefined &&
            idempotencyKey !== null &&
            !isNonEmptyString(idempotencyKey, 128)
        )
            return next(new BadRequestError("Invalid idempotencyKey"));

        const from = container.repos.accounts.findById(fromAccountId);
        if (!from) return next(new NotFoundError("Source account not found"));
        if (from.userId !== user.id)
            return next(new ForbiddenError("Source account does not belong to user"));

        const t = payBill(
            {
                db: container.db,
                clock: container.clock,
                ids: container.ids,
                bus: container.bus,
            },
            {
                fromAccountId,
                billerId,
                amountMinor,
                currency: "INR",
                customerRef: typeof customerRef === "string" ? customerRef : undefined,
                idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : undefined,
                ownerUserId: user.id,
            }
        );
        res.json({
            transfer: {
                id: t.id,
                referenceNumber: t.referenceNumber,
                amountMinor: t.amountMinor,
                billerId: t.billerId,
            },
        });
    } catch (err) {
        next(translate(err));
    }
});

function translate(err: unknown): unknown {
    if (err instanceof BillerNotFoundError) return new NotFoundError(err.message);
    if (err instanceof BillerInactiveError) return new ConflictError(err.message);
    if (err instanceof TransferAmountInvalidError) return new BadRequestError(err.message);
    if (err instanceof TransferOverLimitError) return new BadRequestError(err.message);
    if (err instanceof AccountNotFoundError) return new NotFoundError(err.message);
    if (err instanceof AccountNotActiveError) return new ConflictError(err.message);
    if (err instanceof CurrencyMismatchError) return new BadRequestError(err.message);
    if (err instanceof InsufficientFundsError) return new ConflictError(err.message);
    if (err instanceof HttpError) return err;
    return err;
}
