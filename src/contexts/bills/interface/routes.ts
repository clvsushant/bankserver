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
import {
    listSavedBillAccounts,
    removeSavedBillAccount,
    saveBillAccount,
} from "../application/savedBillAccounts";
import { composeDomainErrorTranslation, translateBillDomainError } from "../../../shared/domainErrorTranslate";

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

billsRouter.get("/saved", (req, res, next) => {
    try {
        const user = req.user!;
        const list = listSavedBillAccounts({ saved: container.repos.savedBillAccounts }, user.id);
        res.json({
            savedAccounts: list.map((s) => ({
                id: s.id,
                billerId: s.billerId,
                customerRef: s.customerRef,
                nickname: s.nickname,
                createdAt: s.createdAt.toISOString(),
            })),
        });
    } catch (err) {
        next(err);
    }
});

billsRouter.post("/saved", (req, res, next) => {
    try {
        const user = req.user!;
        const body = (req.body || {}) as Record<string, unknown>;
        const billerId = body.billerId;
        const customerRef = body.customerRef;
        const nickname = body.nickname;
        if (!isUuid(billerId)) return next(new BadRequestError("Invalid billerId"));
        if (!isNonEmptyString(customerRef, 64))
            return next(new BadRequestError("Invalid customerRef"));
        if (!isNonEmptyString(nickname, 64))
            return next(new BadRequestError("Invalid nickname"));
        const saved = saveBillAccount(
            {
                saved: container.repos.savedBillAccounts,
                billers: container.repos.billers,
                ids: container.ids,
                clock: container.clock,
            },
            {
                userId: user.id,
                billerId: billerId as string,
                customerRef: customerRef as string,
                nickname: nickname as string,
            }
        );
        res.status(201).json({
            savedAccount: {
                id: saved.id,
                billerId: saved.billerId,
                customerRef: saved.customerRef,
                nickname: saved.nickname,
                createdAt: saved.createdAt.toISOString(),
            },
        });
    } catch (err) {
        next(translate(err));
    }
});

billsRouter.post("/saved/:id/remove", (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        removeSavedBillAccount({ saved: container.repos.savedBillAccounts }, { userId: user.id, id });
        res.json({ ok: true });
    } catch (err) {
        next(translate(err));
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
    return composeDomainErrorTranslation(err, translateBillDomainError);
}
