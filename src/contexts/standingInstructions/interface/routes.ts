import express from "express";
import { container } from "../../../container";
import { isUuid } from "../../../utils/validate";
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
import {
    cancelStandingInstruction,
    createStandingInstruction,
    pauseStandingInstruction,
    resumeStandingInstruction,
} from "../application/manageInstructions";
import {
    StandingInstructionInvalidStateError,
    StandingInstructionNotFoundError,
} from "../domain/errors";
import { AccountNotFoundError } from "../../accounts/domain/errors";
import { BeneficiaryNotFoundError } from "../../beneficiaries/domain/errors";

export const standingInstructionsRouter = express.Router();

const ALLOWED_FREQUENCIES = ["daily", "weekly", "monthly"] as const;

standingInstructionsRouter.get("/", (req, res, next) => {
    try {
        const user = req.user!;
        const list = container.repos.standingInstructions.listByOwner(user.id);
        res.json({ instructions: list.map(serialize) });
    } catch (err) {
        next(err);
    }
});

standingInstructionsRouter.post(
    "/",
    requireStepUp("standing.create"),
    auditMiddleware(AuditActions.StandingInstructionCreated),
    (req, res, next) => {
    try {
        const user = req.user!;
        const body = (req.body || {}) as Record<string, unknown>;
        const fromAccountId = body.fromAccountId;
        const beneficiaryId = body.beneficiaryId;
        const amountMinor = body.amountMinor;
        const frequency = body.frequency;
        const description = body.description;

        if (!isUuid(fromAccountId))
            return next(new BadRequestError("Invalid fromAccountId"));
        if (!isUuid(beneficiaryId))
            return next(new BadRequestError("Invalid beneficiaryId"));
        if (
            typeof amountMinor !== "number" ||
            !Number.isInteger(amountMinor) ||
            amountMinor <= 0
        )
            return next(new BadRequestError("Invalid amountMinor"));
        if (typeof frequency !== "string" || !ALLOWED_FREQUENCIES.includes(frequency as never))
            return next(new BadRequestError("Invalid frequency"));
        if (
            description !== undefined &&
            description !== null &&
            (typeof description !== "string" || description.length > 256)
        )
            return next(new BadRequestError("Invalid description"));

        const si = createStandingInstruction(
            {
                repo: container.repos.standingInstructions,
                accounts: container.repos.accounts,
                beneficiaries: container.repos.beneficiaries,
                kyc: container.repos.kyc,
                ids: container.ids,
                clock: container.clock,
                bus: container.bus,
            },
            {
                ownerUserId: user.id,
                fromAccountId,
                beneficiaryId,
                amountMinor,
                currency: "INR",
                frequency: frequency as "daily" | "weekly" | "monthly",
                description: typeof description === "string" ? description : undefined,
            }
        );
        res.status(201).json({ instruction: serialize(si) });
    } catch (err) {
        next(translate(err));
    }
});

standingInstructionsRouter.post(
    "/:id/pause",
    requireStepUp("standing.update"),
    auditMiddleware(AuditActions.StandingInstructionPaused, {
        target: (req) =>
            req.params.id ? { type: "standing_instruction", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        pauseStandingInstruction(
            {
                repo: container.repos.standingInstructions,
                clock: container.clock,
                bus: container.bus,
            },
            { ownerUserId: user.id, id }
        );
        const si = container.repos.standingInstructions.findById(id);
        res.json({ instruction: serialize(si) });
    } catch (err) {
        next(translate(err));
    }
});

standingInstructionsRouter.post(
    "/:id/resume",
    requireStepUp("standing.update"),
    auditMiddleware(AuditActions.StandingInstructionResumed, {
        target: (req) =>
            req.params.id ? { type: "standing_instruction", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        resumeStandingInstruction(
            {
                repo: container.repos.standingInstructions,
                clock: container.clock,
                bus: container.bus,
            },
            { ownerUserId: user.id, id }
        );
        const si = container.repos.standingInstructions.findById(id);
        res.json({ instruction: serialize(si) });
    } catch (err) {
        next(translate(err));
    }
});

standingInstructionsRouter.post(
    "/:id/cancel",
    requireStepUp("standing.cancel"),
    auditMiddleware(AuditActions.StandingInstructionCancelled, {
        target: (req) =>
            req.params.id ? { type: "standing_instruction", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        cancelStandingInstruction(
            {
                repo: container.repos.standingInstructions,
                clock: container.clock,
                bus: container.bus,
            },
            { ownerUserId: user.id, id }
        );
        const si = container.repos.standingInstructions.findById(id);
        res.json({ instruction: serialize(si) });
    } catch (err) {
        next(translate(err));
    }
});

function serialize(si: ReturnType<typeof container.repos.standingInstructions.findById>) {
    if (!si) return null;
    return {
        id: si.id,
        fromAccountId: si.fromAccountId,
        beneficiaryId: si.beneficiaryId,
        amountMinor: si.amountMinor,
        currency: si.currency,
        frequency: si.frequency,
        nextRunAt: si.nextRunAt.toISOString(),
        lastRunAt: si.lastRunAt?.toISOString(),
        status: si.status,
        description: si.description,
        createdAt: si.createdAt.toISOString(),
    };
}

function translate(err: unknown): unknown {
    if (err instanceof StandingInstructionNotFoundError) return new NotFoundError(err.message);
    if (err instanceof StandingInstructionInvalidStateError) return new ConflictError(err.message);
    if (err instanceof AccountNotFoundError) return new NotFoundError(err.message);
    if (err instanceof BeneficiaryNotFoundError) return new NotFoundError(err.message);
    if (err instanceof HttpError) return err;
    return err;
}
