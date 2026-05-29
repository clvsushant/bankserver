import express from "express";
import { container } from "../../../container";
import { isNonEmptyString, isUuid } from "../../../utils/validate";
import { BadRequestError, ConflictError, ForbiddenError, HttpError, NotFoundError } from "../../../utils/errors";
import { requireBankingAccess } from "../../../middleware/banking-access";
import { requireStepUp } from "../../../middleware/step-up";
import { auditMiddleware } from "../../audit/interface/middleware";
import { AuditActions } from "../../audit/domain/actions";
import { freezeAccount, unfreezeAccount } from "../application/freezeAccount";
import { openAdditionalAccount } from "../application/createAccount";
import { openFixedDeposit } from "../application/openFixedDeposit";
import { prematureCloseFixedDeposit } from "../application/prematureCloseFixedDeposit";
import { closeAccount } from "../application/closeAccount";
import { addNominee, listNominees, removeNominee } from "../application/nominee";
import {
    composeDomainErrorTranslation,
} from "../../../shared/domainErrorTranslate";
import {
    ACCOUNT_TYPE_META,
    ACCOUNT_TYPES,
    availableBalanceMinor,
    isAccountType,
    minBalanceForType,
    type Account,
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
    requireBankingAccess,
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

accountsCustomerRouter.get("/fixed-deposits", requireBankingAccess, (req, res, next) => {
    try {
        const user = req.user!;
        const list = container.repos.fixedDeposits.listByUserId(user.id);
        res.json({ fixedDeposits: list.map(serializeFd) });
    } catch (err) {
        next(err);
    }
});

accountsCustomerRouter.post(
    "/fixed-deposits",
    requireBankingAccess,
    requireStepUp("fd.open"),
    auditMiddleware(AuditActions.FixedDepositOpened),
    (req, res, next) => {
        try {
            const user = req.user!;
            const body = (req.body || {}) as Record<string, unknown>;
            const payoutAccountId = body.payoutAccountId;
            const principalMinor = body.principalMinor;
            const tenureMonths = body.tenureMonths;
            const autoRenew = body.autoRenew;
            if (!isUuid(payoutAccountId))
                return next(new BadRequestError("Invalid payoutAccountId"));
            if (
                typeof principalMinor !== "number" ||
                !Number.isInteger(principalMinor) ||
                principalMinor <= 0
            )
                return next(new BadRequestError("Invalid principalMinor"));
            if (
                typeof tenureMonths !== "number" ||
                !Number.isInteger(tenureMonths) ||
                tenureMonths <= 0
            )
                return next(new BadRequestError("Invalid tenureMonths"));

            const fd = openFixedDeposit(
                {
                    db: container.db,
                    accounts: container.repos.accounts,
                    fixedDeposits: container.repos.fixedDeposits,
                    ids: container.ids,
                    clock: container.clock,
                    bus: container.bus,
                },
                {
                    userId: user.id,
                    payoutAccountId: payoutAccountId as string,
                    principalMinor,
                    tenureMonths,
                    autoRenew: autoRenew === true,
                }
            );
            res.status(201).json({ fixedDeposit: serializeFd(fd) });
        } catch (err) {
            next(translate(err));
        }
    }
);

accountsCustomerRouter.post(
    "/fixed-deposits/:id/premature-close",
    requireBankingAccess,
    requireStepUp("fd.premature_close"),
    auditMiddleware(AuditActions.FixedDepositPrematureClosed),
    (req, res, next) => {
        try {
            const user = req.user!;
            const { id } = req.params;
            if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
            const fd = prematureCloseFixedDeposit(
                {
                    db: container.db,
                    fixedDeposits: container.repos.fixedDeposits,
                    clock: container.clock,
                    ids: container.ids,
                },
                { userId: user.id, fixedDepositId: id }
            );
            res.json({ fixedDeposit: serializeFd(fd) });
        } catch (err) {
            next(translate(err));
        }
    }
);

accountsCustomerRouter.post(
    "/:id/close",
    requireBankingAccess,
    requireStepUp("account.close"),
    auditMiddleware(AuditActions.AccountClosed, {
        target: (req) =>
            req.params.id ? { type: "account", id: req.params.id } : null,
    }),
    (req, res, next) => {
        try {
            const user = req.user!;
            const { id } = req.params;
            if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
            const a = closeAccount(
                {
                    accounts: container.repos.accounts,
                    fixedDeposits: container.repos.fixedDeposits,
                    cards: container.repos.cards,
                    standingInstructions: container.repos.standingInstructions,
                    clock: container.clock,
                    bus: container.bus,
                },
                { userId: user.id, accountId: id }
            );
            res.json({ account: serialize(a) });
        } catch (err) {
            next(translate(err));
        }
    }
);

accountsCustomerRouter.get("/:id/nominees", requireBankingAccess, (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        const list = listNominees(
            { accounts: container.repos.accounts, nominees: container.repos.nominees },
            { userId: user.id, accountId: id }
        );
        res.json({ nominees: list.map(serializeNominee) });
    } catch (err) {
        next(translate(err));
    }
});

accountsCustomerRouter.post("/:id/nominees", requireBankingAccess, (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        const body = (req.body || {}) as Record<string, unknown>;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        if (!isNonEmptyString(body.fullName, 128))
            return next(new BadRequestError("Invalid fullName"));
        if (!isNonEmptyString(body.relation, 64))
            return next(new BadRequestError("Invalid relation"));
        const n = addNominee(
            {
                accounts: container.repos.accounts,
                nominees: container.repos.nominees,
                ids: container.ids,
                clock: container.clock,
            },
            {
                userId: user.id,
                accountId: id,
                fullName: body.fullName as string,
                relation: body.relation as string,
                sharePercent:
                    typeof body.sharePercent === "number" ? body.sharePercent : undefined,
            }
        );
        res.status(201).json({ nominee: serializeNominee(n) });
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

function serialize(a: Account | null | undefined) {
    if (!a) return null;
    return {
        id: a.id,
        accountNumber: a.accountNumber,
        userId: a.userId,
        accountType: a.accountType,
        status: a.status,
        balanceMinor: a.balanceMinor,
        holdBalanceMinor: a.holdBalanceMinor,
        availableBalanceMinor: availableBalanceMinor(a),
        minBalanceMinor: minBalanceForType(a.accountType),
        currency: a.currency,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
    };
}

function serializeFd(fd: ReturnType<typeof container.repos.fixedDeposits.findById>) {
    if (!fd) return null;
    return {
        id: fd.id,
        accountId: fd.accountId,
        payoutAccountId: fd.payoutAccountId,
        principalMinor: fd.principalMinor,
        tenureMonths: fd.tenureMonths,
        interestRateBps: fd.interestRateBps,
        openedAt: fd.openedAt.toISOString(),
        maturityAt: fd.maturityAt.toISOString(),
        autoRenew: fd.autoRenew,
        status: fd.status,
        closedAt: fd.closedAt?.toISOString(),
        interestPaidMinor: fd.interestPaidMinor,
    };
}

function serializeNominee(n: ReturnType<typeof container.repos.nominees.findById>) {
    if (!n) return null;
    return {
        id: n.id,
        accountId: n.accountId,
        fullName: n.fullName,
        relation: n.relation,
        sharePercent: n.sharePercent,
        createdAt: n.createdAt.toISOString(),
    };
}

function translate(err: unknown): unknown {
    return composeDomainErrorTranslation(err);
}

// Suppress unused-import warning when only the type narrowing call is used.
void ForbiddenError;
