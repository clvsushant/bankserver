import express from "express";
import { container } from "../../../container";
import { isNonEmptyString, isUuid } from "../../../utils/validate";
import {
    BadRequestError,
    ConflictError,
    HttpError,
    NotFoundError,
} from "../../../utils/errors";
import { requireStepUp } from "../../../middleware/step-up";
import { auditMiddleware } from "../../audit/interface/middleware";
import { AuditActions } from "../../audit/domain/actions";
import {
    addBeneficiary,
    removeBeneficiary,
} from "../application/manageBeneficiary";
import {
    BeneficiaryAlreadyExistsError,
    BeneficiaryNotFoundError,
    BeneficiarySelfTargetError,
    BeneficiaryUnknownAccountError,
} from "../domain/errors";
import { isValidAccountNumber } from "../domain/beneficiary";

export const beneficiariesRouter = express.Router();

beneficiariesRouter.get("/", (req, res, next) => {
    try {
        const user = req.user!;
        const list = container.repos.beneficiaries.listByOwner(user.id);
        res.json({ beneficiaries: list.map(serialize) });
    } catch (err) {
        next(err);
    }
});

beneficiariesRouter.post(
    "/",
    requireStepUp("beneficiary.add"),
    auditMiddleware(AuditActions.BeneficiaryAdded),
    (req, res, next) => {
    try {
        const user = req.user!;
        const body = (req.body || {}) as Record<string, unknown>;
        const nickname = body.nickname as unknown;
        const accountNumber = body.accountNumber as unknown;

        if (!isNonEmptyString(nickname, 64))
            return next(new BadRequestError("Invalid nickname"));
        if (!isValidAccountNumber(accountNumber))
            return next(new BadRequestError("Invalid account number"));

        const b = addBeneficiary(
            {
                repo: container.repos.beneficiaries,
                accounts: container.repos.accounts,
                users: container.repos.users,
                ids: container.ids,
                clock: container.clock,
                bus: container.bus,
            },
            { ownerUserId: user.id, nickname, accountNumber }
        );
        res.status(201).json({ beneficiary: serialize(b) });
    } catch (err) {
        next(translate(err));
    }
});

beneficiariesRouter.post(
    "/:id/remove",
    requireStepUp("beneficiary.remove"),
    auditMiddleware(AuditActions.BeneficiaryRemoved, {
        target: (req) =>
            req.params.id ? { type: "beneficiary", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        removeBeneficiary(
            {
                repo: container.repos.beneficiaries,
                clock: container.clock,
                bus: container.bus,
            },
            { ownerUserId: user.id, beneficiaryId: id }
        );
        res.json({ success: true });
    } catch (err) {
        next(translate(err));
    }
});

function serialize(b: ReturnType<typeof container.repos.beneficiaries.findById>) {
    if (!b) return null;
    return {
        id: b.id,
        nickname: b.nickname,
        accountNumber: b.accountNumber,
        beneficiaryUsername: b.beneficiaryUsername,
        createdAt: b.createdAt.toISOString(),
        lastUsedAt: b.lastUsedAt?.toISOString(),
    };
}

function translate(err: unknown): unknown {
    if (err instanceof BeneficiaryAlreadyExistsError) return new ConflictError(err.message);
    if (err instanceof BeneficiaryNotFoundError) return new NotFoundError(err.message);
    if (err instanceof BeneficiarySelfTargetError) return new BadRequestError(err.message);
    if (err instanceof BeneficiaryUnknownAccountError) return new NotFoundError(err.message);
    if (err instanceof HttpError) return err;
    return err;
}
