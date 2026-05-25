import express from "express";
import { container } from "../../../container";
import { isUuid } from "../../../utils/validate";
import { BadRequestError, ConflictError, ForbiddenError, HttpError, NotFoundError } from "../../../utils/errors";
import { requireStepUp } from "../../../middleware/step-up";
import { auditMiddleware } from "../../audit/interface/middleware";
import { AuditActions } from "../../audit/domain/actions";
import { freezeAccount, unfreezeAccount } from "../application/freezeAccount";
import { openAdditionalAccount } from "../application/createAccount";
import {
    AccountNotFoundError,
    AccountInvalidStatusTransitionError,
} from "../domain/errors";
import {
    ACCOUNT_TYPE_META,
    ACCOUNT_TYPES,
    isAccountType,
    type AccountType,
} from "../domain/account";

export const accountsCustomerRouter = express.Router();
export const accountsAdminRouter = express.Router();

accountsCustomerRouter.get("/me", (req, res, next) => {
    try {
        const user = req.user!;
        const accs = container.repos.accounts.listByUserId(user.id);
        res.json({ accounts: accs.map(serialize) });
    } catch (err) {
        next(err);
    }
});

/** GET /accounts/types — public-ish picker metadata. Behind requireSession. */
accountsCustomerRouter.get("/types", (_req, res, next) => {
    try {
        res.json({
            types: ACCOUNT_TYPES.map((t) => ({
                type: t,
                label: ACCOUNT_TYPE_META[t].label,
                description: ACCOUNT_TYPE_META[t].description,
            })),
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /accounts — open an additional account. Requires that the user has
 * already had at least one approved KYC. Step-up gated.
 */
accountsCustomerRouter.post(
    "/",
    requireStepUp("account.open"),
    auditMiddleware(AuditActions.AccountOpened),
    (req, res, next) => {
    try {
        const user = req.user!;
        const body = (req.body || {}) as Record<string, unknown>;
        const accountType = body.accountType;
        if (!isAccountType(accountType))
            return next(new BadRequestError("Invalid accountType"));

        const apps = container.repos.kyc.listByUserId(user.id);
        const approved = apps.find((a) => a.status === "Approved");
        if (!approved)
            return next(new ConflictError("KYC must be approved before opening more accounts"));

        const acc = openAdditionalAccount(
            {
                repo: container.repos.accounts,
                ids: container.ids,
                clock: container.clock,
                bus: container.bus,
            },
            { userId: user.id, accountType: accountType as AccountType }
        );
        res.status(201).json({ account: serialize(acc) });
    } catch (err) {
        next(translate(err));
    }
});

accountsAdminRouter.get(
    "/",
    auditMiddleware(AuditActions.AdminAccountsListed),
    (_req, res, next) => {
        try {
            const accs = container.repos.accounts.list(200);
            res.json({ accounts: accs.map(serialize) });
        } catch (err) {
            next(err);
        }
    }
);

accountsAdminRouter.post(
    "/:id/freeze",
    auditMiddleware(AuditActions.AccountFrozen, {
        target: (req) =>
            req.params.id ? { type: "account", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        if (!isUuid(req.params.id)) return next(new BadRequestError("Invalid id"));
        const a = freezeAccount(
            {
                repo: container.repos.accounts,
                clock: container.clock,
                bus: container.bus,
            },
            { accountId: req.params.id }
        );
        res.json({ account: serialize(a) });
    } catch (err) {
        next(translate(err));
    }
});

accountsAdminRouter.post(
    "/:id/unfreeze",
    auditMiddleware(AuditActions.AccountUnfrozen, {
        target: (req) =>
            req.params.id ? { type: "account", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        if (!isUuid(req.params.id)) return next(new BadRequestError("Invalid id"));
        const a = unfreezeAccount(
            {
                repo: container.repos.accounts,
                clock: container.clock,
                bus: container.bus,
            },
            { accountId: req.params.id }
        );
        res.json({ account: serialize(a) });
    } catch (err) {
        next(translate(err));
    }
});

function serialize(a: ReturnType<typeof container.repos.accounts.findById>) {
    if (!a) return null;
    return {
        id: a.id,
        accountNumber: a.accountNumber,
        userId: a.userId,
        accountType: a.accountType,
        status: a.status,
        balanceMinor: a.balanceMinor,
        currency: a.currency,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
    };
}

function translate(err: unknown): unknown {
    if (err instanceof AccountNotFoundError) return new NotFoundError(err.message);
    if (err instanceof AccountInvalidStatusTransitionError)
        return new BadRequestError(err.message);
    if (err instanceof HttpError) return err;
    return err;
}

// Suppress unused-import warning when only the type narrowing call is used.
void ForbiddenError;
