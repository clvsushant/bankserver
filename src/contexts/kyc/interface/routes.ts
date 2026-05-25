import express from "express";
import { container } from "../../../container";
import { isNonEmptyString, isUuid } from "../../../utils/validate";
import {
    BadRequestError,
    ConflictError,
    HttpError,
    NotFoundError,
} from "../../../utils/errors";
import { auditMiddleware } from "../../audit/interface/middleware";
import { AuditActions } from "../../audit/domain/actions";
import { submitKyc } from "../application/submitKyc";
import { approveKyc, rejectKyc } from "../application/decideKyc";
import {
    KycAlreadyExistsError,
    KycInvalidPanError,
    KycInvalidTransitionError,
    KycNotFoundError,
} from "../domain/errors";
import { isAccountType, type AccountType } from "../../accounts/domain/account";

/**
 * Customer-facing KYC routes (mounted at /kyc, behind requireSession).
 * Admin-facing routes are mounted separately under /admin/kyc.
 */
export const kycCustomerRouter = express.Router();

kycCustomerRouter.post("/", auditMiddleware(AuditActions.KycSubmitted), (req, res, next) => {
    try {
        const user = req.user!;
        const body = (req.body || {}) as Record<string, unknown>;
        const { fullName, dob, pan, address, docB64, requestedAccountType } = body;
        if (!isNonEmptyString(fullName, 128))
            return next(new BadRequestError("Invalid fullName"));
        if (!isNonEmptyString(dob, 10)) return next(new BadRequestError("Invalid dob"));
        if (!isNonEmptyString(pan, 10)) return next(new BadRequestError("Invalid pan"));
        if (!isNonEmptyString(address, 256))
            return next(new BadRequestError("Invalid address"));
        if (docB64 !== undefined && (typeof docB64 !== "string" || docB64.length > 32 * 1024))
            return next(new BadRequestError("Invalid docB64"));
        if (
            requestedAccountType !== undefined &&
            requestedAccountType !== null &&
            !isAccountType(requestedAccountType)
        )
            return next(new BadRequestError("Invalid requestedAccountType"));

        const app = submitKyc(
            {
                repo: container.repos.kyc,
                ids: container.ids,
                clock: container.clock,
                bus: container.bus,
            },
            {
                userId: user.id,
                fullName,
                dob,
                pan,
                address,
                docB64: docB64 as string | undefined,
                requestedAccountType: isAccountType(requestedAccountType)
                    ? (requestedAccountType as AccountType)
                    : undefined,
            }
        );
        res.status(201).json({ application: serialize(app) });
    } catch (err) {
        next(translate(err));
    }
});

kycCustomerRouter.get("/me", (req, res, next) => {
    try {
        const user = req.user!;
        const apps = container.repos.kyc.listByUserId(user.id);
        res.json({ applications: apps.map(serialize) });
    } catch (err) {
        next(err);
    }
});

/** Admin router — wired under /admin/kyc with requireRole("admin"). */
export const kycAdminRouter = express.Router();

kycAdminRouter.get(
    "/queue",
    auditMiddleware(AuditActions.AdminKycListed),
    (_req, res, next) => {
        try {
            const apps = container.repos.kyc.listByStatus("Submitted", 100);
            res.json({ applications: apps.map(serialize) });
        } catch (err) {
            next(err);
        }
    }
);

kycAdminRouter.post(
    "/:id/approve",
    auditMiddleware(AuditActions.KycApproved, {
        target: (req) =>
            req.params.id ? { type: "kyc_application", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        const adminUser = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        const result = approveKyc(
            { repo: container.repos.kyc, clock: container.clock, bus: container.bus },
            { applicationId: id, adminUserId: adminUser.id }
        );
        res.json({ application: serialize(result) });
    } catch (err) {
        next(translate(err));
    }
});

kycAdminRouter.post(
    "/:id/reject",
    auditMiddleware(AuditActions.KycRejected, {
        target: (req) =>
            req.params.id ? { type: "kyc_application", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        const adminUser = req.user!;
        const { id } = req.params;
        const reason = (req.body as { reason?: unknown })?.reason;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        if (!isNonEmptyString(reason, 256))
            return next(new BadRequestError("Invalid reason"));
        const result = rejectKyc(
            { repo: container.repos.kyc, clock: container.clock, bus: container.bus },
            { applicationId: id, adminUserId: adminUser.id, reason }
        );
        res.json({ application: serialize(result) });
    } catch (err) {
        next(translate(err));
    }
});

function serialize(app: ReturnType<typeof container.repos.kyc.findById>) {
    if (!app) return null;
    return {
        id: app.id,
        userId: app.userId,
        fullName: app.fullName,
        dob: app.dob,
        pan: app.pan,
        address: app.address,
        requestedAccountType: app.requestedAccountType,
        status: app.status,
        submittedAt: app.submittedAt.toISOString(),
        decidedAt: app.decidedAt?.toISOString(),
        rejectReason: app.rejectReason,
    };
}

function translate(err: unknown): unknown {
    if (err instanceof KycAlreadyExistsError) return new ConflictError(err.message);
    if (err instanceof KycInvalidPanError) return new BadRequestError(err.message);
    if (err instanceof KycInvalidTransitionError) return new ConflictError(err.message);
    if (err instanceof KycNotFoundError) return new NotFoundError(err.message);
    if (err instanceof HttpError) return err;
    return err;
}
