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
    renameBeneficiary,
} from "../application/manageBeneficiary";
import {
    addExternalBeneficiary,
    listExternalBeneficiaries,
} from "../application/externalBeneficiary";
import {
    BeneficiaryAlreadyExistsError,
    BeneficiaryCoolingPeriodError,
    BeneficiaryNotFoundError,
    BeneficiarySelfTargetError,
    BeneficiaryUnknownAccountError,
} from "../domain/errors";
import { isTransferAllowed, isValidAccountNumber } from "../domain/beneficiary";
import type { Beneficiary } from "../domain/beneficiary";

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
    "/:id/rename",
    requireStepUp("beneficiary.rename"),
    auditMiddleware(AuditActions.BeneficiaryRenamed, {
        target: (req) =>
            req.params.id ? { type: "beneficiary", id: req.params.id } : null,
    }),
    (req, res, next) => {
        try {
            const user = req.user!;
            const { id } = req.params;
            const nickname = (req.body as { nickname?: unknown })?.nickname;
            if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
            if (!isNonEmptyString(nickname, 64))
                return next(new BadRequestError("Invalid nickname"));
            const b = renameBeneficiary(
                {
                    repo: container.repos.beneficiaries,
                    clock: container.clock,
                    bus: container.bus,
                },
                { ownerUserId: user.id, beneficiaryId: id, nickname: nickname as string }
            );
            res.json({ beneficiary: serialize(b) });
        } catch (err) {
            next(translate(err));
        }
    }
);

beneficiariesRouter.get("/external", (req, res, next) => {
    try {
        const user = req.user!;
        const list = listExternalBeneficiaries(
            { repo: container.repos.externalBeneficiaries },
            user.id
        );
        res.json({ externalBeneficiaries: list.map(serializeExternal) });
    } catch (err) {
        next(err);
    }
});

beneficiariesRouter.post("/external", requireStepUp("beneficiary.add"), (req, res, next) => {
    try {
        const user = req.user!;
        const body = (req.body || {}) as Record<string, unknown>;
        if (!isNonEmptyString(body.nickname, 64))
            return next(new BadRequestError("Invalid nickname"));
        if (!isNonEmptyString(body.accountNumber, 32))
            return next(new BadRequestError("Invalid accountNumber"));
        if (!isNonEmptyString(body.ifsc, 11))
            return next(new BadRequestError("Invalid ifsc"));
        if (!isNonEmptyString(body.bankName, 128))
            return next(new BadRequestError("Invalid bankName"));
        if (!isNonEmptyString(body.beneficiaryName, 128))
            return next(new BadRequestError("Invalid beneficiaryName"));

        const b = addExternalBeneficiary(
            {
                repo: container.repos.externalBeneficiaries,
                ids: container.ids,
                clock: container.clock,
            },
            {
                ownerUserId: user.id,
                nickname: body.nickname as string,
                accountNumber: body.accountNumber as string,
                ifsc: (body.ifsc as string).toUpperCase(),
                bankName: body.bankName as string,
                beneficiaryName: body.beneficiaryName as string,
                vpa: typeof body.vpa === "string" ? body.vpa : undefined,
                preferredRail:
                    body.preferredRail === "imps" ||
                    body.preferredRail === "neft" ||
                    body.preferredRail === "rtgs" ||
                    body.preferredRail === "upi"
                        ? body.preferredRail
                        : undefined,
            }
        );
        res.status(201).json({ externalBeneficiary: serializeExternal(b) });
    } catch (err) {
        next(err instanceof Error ? new BadRequestError(err.message) : err);
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

function serialize(b: Beneficiary | null | undefined) {
    if (!b) return null;
    const now = new Date();
    const coolingActive = !isTransferAllowed(b, now);
    return {
        id: b.id,
        nickname: b.nickname,
        accountNumber: b.accountNumber,
        beneficiaryUsername: b.beneficiaryUsername,
        status: b.status,
        activatedAt: b.activatedAt?.toISOString(),
        transferAllowed: !coolingActive,
        coolingActive,
        createdAt: b.createdAt.toISOString(),
        lastUsedAt: b.lastUsedAt?.toISOString(),
    };
}

function serializeExternal(
    b: ReturnType<typeof container.repos.externalBeneficiaries.findById>
) {
    if (!b) return null;
    return {
        id: b.id,
        nickname: b.nickname,
        accountNumber: b.accountNumber,
        ifsc: b.ifsc,
        bankName: b.bankName,
        beneficiaryName: b.beneficiaryName,
        vpa: b.vpa,
        preferredRail: b.preferredRail,
        status: b.status,
        activatedAt: b.activatedAt?.toISOString(),
        createdAt: b.createdAt.toISOString(),
    };
}

function translate(err: unknown): unknown {
    if (err instanceof BeneficiaryAlreadyExistsError) return new ConflictError(err.message);
    if (err instanceof BeneficiaryNotFoundError) return new NotFoundError(err.message);
    if (err instanceof BeneficiarySelfTargetError) return new BadRequestError(err.message);
    if (err instanceof BeneficiaryUnknownAccountError) return new NotFoundError(err.message);
    if (err instanceof BeneficiaryCoolingPeriodError) return new ConflictError(err.message);
    if (err instanceof HttpError) return err;
    return err;
}
