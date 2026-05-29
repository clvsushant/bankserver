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
import { executeTransfer } from "../application/executeTransfer";
import { executeRailTransfer } from "../application/executeRailTransfer";
import { faucetDeposit } from "../application/faucetDeposit";
import { fileDispute, listDisputes, decideDispute } from "../application/disputes";
import { getKycTier } from "../../identity/application/kycTier";
import { previewLimits } from "../../../services/transferLimits";
import {
    approvePendingAction,
    createPendingAction,
    listPendingActions,
    markPendingExecuted,
    requiresMakerChecker,
} from "../../../services/adminMakerChecker";
import { BeneficiaryCoolingPeriodError } from "../../beneficiaries/domain/errors";
import { isTransferAllowed } from "../../beneficiaries/domain/beneficiary";
import { touchBeneficiaryByAccount } from "../../beneficiaries/application/manageBeneficiary";
import { composeDomainErrorTranslation, translateDisputePlainError } from "../../../shared/domainErrorTranslate";
import { emitNotification } from "../../notifications/application/createNotification";

export const transferCustomerRouter = express.Router();
export const transactionsAdminRouter = express.Router();
export const faucetAdminRouter = express.Router();

// POST /transfer is the only step-up-gated endpoint in this router. The
// read-only listing below stays available to any authenticated user.
transferCustomerRouter.post(
    "/",
    requireStepUp("transfer"),
    auditMiddleware(AuditActions.TransferExecuted, {
        target: (req) => {
            const id = (req.body as { fromAccountId?: string })?.fromAccountId;
            return id ? { type: "account", id } : null;
        },
    }),
    (req, res, next) => {
    try {
        const user = req.user!;
        const body = (req.body || {}) as Record<string, unknown>;
        const fromAccountId = body.fromAccountId;
        let toAccountNumber = body.toAccountNumber as unknown;
        const beneficiaryId = body.beneficiaryId as unknown;
        const amountMinor = body.amountMinor;
        const memo = body.memo;
        const idempotencyKey = body.idempotencyKey;

        if (!isUuid(fromAccountId))
            return next(new BadRequestError("Invalid fromAccountId"));

        // beneficiaryId is an alternate addressing mode — resolve it to the
        // saved account number. Validates ownership before letting it stand
        // in for `toAccountNumber`.
        let resolvedBeneficiaryId: string | undefined;
        if (typeof beneficiaryId === "string" && beneficiaryId.length > 0) {
            if (!isUuid(beneficiaryId))
                return next(new BadRequestError("Invalid beneficiaryId"));
            const b = container.repos.beneficiaries.findById(beneficiaryId);
            if (!b || b.ownerUserId !== user.id)
                return next(new NotFoundError("Beneficiary not found"));
            if (!isTransferAllowed(b, container.clock.now()))
                return next(translate(new BeneficiaryCoolingPeriodError()));
            toAccountNumber = b.accountNumber;
            resolvedBeneficiaryId = b.id;
        }

        if (!isNonEmptyString(toAccountNumber, 32))
            return next(new BadRequestError("Invalid toAccountNumber"));
        if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor <= 0)
            return next(new BadRequestError("Invalid amountMinor"));
        if (memo !== undefined && memo !== null && (typeof memo !== "string" || memo.length > 256))
            return next(new BadRequestError("Invalid memo"));
        if (idempotencyKey !== undefined && !isNonEmptyString(idempotencyKey, 128))
            return next(new BadRequestError("Invalid idempotencyKey"));

        // Authorization: the source account must belong to the caller.
        const from = container.repos.accounts.findById(fromAccountId);
        if (!from) return next(new NotFoundError("Source account not found"));
        if (from.userId !== user.id)
            return next(new ForbiddenError("Source account does not belong to user"));

        const kycTier = getKycTier({ users: container.repos.users }, user.id);
        const transfer = executeTransfer(
            {
                db: container.db,
                clock: container.clock,
                ids: container.ids,
                bus: container.bus,
                beneficiaries: container.repos.beneficiaries,
            },
            {
                fromAccountId,
                toAccountNumber: toAccountNumber as string,
                amountMinor,
                currency: "INR",
                memo: typeof memo === "string" ? memo : undefined,
                idempotencyKey: idempotencyKey as string | undefined,
                beneficiaryId: resolvedBeneficiaryId,
                ownerUserId: user.id,
                kycTier,
                rail: "internal",
            }
        );

        // Post-success: stamp last_used_at on the saved beneficiary (if any).
        try {
            touchBeneficiaryByAccount(
                {
                    repo: container.repos.beneficiaries,
                    clock: container.clock,
                },
                { ownerUserId: user.id, accountNumber: toAccountNumber as string }
            );
        } catch {
            // Best-effort; never fail the response on this.
        }

        res.json({ transfer: serialize(transfer) });
    } catch (err) {
        next(translate(err));
    }
});

transferCustomerRouter.get("/limits", (req, res, next) => {
    try {
        const user = req.user!;
        const accounts = container.repos.accounts.listByUserId(user.id);
        const kycTier = getKycTier({ users: container.repos.users }, user.id);
        const preview = previewLimits(container.db, {
            userId: user.id,
            accountIds: accounts.map((a) => a.id),
            kycTier,
            now: container.clock.now(),
        });
        res.json({ limits: preview, kycTier });
    } catch (err) {
        next(err);
    }
});

transferCustomerRouter.post(
    "/rail",
    requireStepUp("transfer"),
    auditMiddleware(AuditActions.TransferRailExecuted),
    (req, res, next) => {
        try {
            const user = req.user!;
            const body = (req.body || {}) as Record<string, unknown>;
            const fromAccountId = body.fromAccountId;
            const toAccountNumber = body.toAccountNumber;
            const amountMinor = body.amountMinor;
            const rail = body.rail;
            const vpa = body.vpa;
            const memo = body.memo;
            const idempotencyKey = body.idempotencyKey;
            const ifsc = body.ifsc;
            if (!isUuid(fromAccountId))
                return next(new BadRequestError("Invalid fromAccountId"));
            if (!isNonEmptyString(toAccountNumber, 32))
                return next(new BadRequestError("Invalid toAccountNumber"));
            if (
                typeof amountMinor !== "number" ||
                !Number.isInteger(amountMinor) ||
                amountMinor <= 0
            )
                return next(new BadRequestError("Invalid amountMinor"));
            if (rail !== "imps" && rail !== "neft" && rail !== "rtgs" && rail !== "upi")
                return next(new BadRequestError("Invalid rail"));
            if (memo !== undefined && memo !== null && (typeof memo !== "string" || memo.length > 256))
                return next(new BadRequestError("Invalid memo"));
            if (idempotencyKey !== undefined && !isNonEmptyString(idempotencyKey, 128))
                return next(new BadRequestError("Invalid idempotencyKey"));
            if (ifsc !== undefined && ifsc !== null) {
                if (typeof ifsc !== "string" || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase()))
                    return next(new BadRequestError("Invalid ifsc"));
            }

            const from = container.repos.accounts.findById(fromAccountId as string);
            if (!from || from.userId !== user.id)
                return next(new ForbiddenError("Source account does not belong to user"));

            const kycTier = getKycTier({ users: container.repos.users }, user.id);
            const transfer = executeRailTransfer(
                {
                    db: container.db,
                    clock: container.clock,
                    ids: container.ids,
                    bus: container.bus,
                },
                {
                    fromAccountId: fromAccountId as string,
                    toAccountNumber: toAccountNumber as string,
                    amountMinor,
                    currency: "INR",
                    rail,
                    memo: typeof memo === "string" ? memo : undefined,
                    idempotencyKey: idempotencyKey as string | undefined,
                    vpa: typeof vpa === "string" ? vpa : undefined,
                    ifsc: typeof ifsc === "string" ? ifsc.toUpperCase() : undefined,
                    ownerUserId: user.id,
                    kycTier,
                }
            );
            res.json({ transfer: serialize(transfer) });
        } catch (err) {
            next(translate(err));
        }
    }
);

transferCustomerRouter.post("/disputes", auditMiddleware(AuditActions.DisputeFiled), (req, res, next) => {
    try {
        const user = req.user!;
        const body = (req.body || {}) as Record<string, unknown>;
        const transferId = body.transferId;
        const reason = body.reason;
        if (!isUuid(transferId)) return next(new BadRequestError("Invalid transferId"));
        if (!isNonEmptyString(reason, 512)) return next(new BadRequestError("Invalid reason"));
        const d = fileDispute(
            {
                disputes: container.repos.disputes,
                transfers: container.repos.transfers,
                accounts: container.repos.accounts,
                ids: container.ids,
                clock: container.clock,
            },
            { userId: user.id, transferId: transferId as string, reason: reason as string }
        );
        emitNotification(
            {
                repo: container.repos.notifications,
                ids: container.ids,
                clock: container.clock,
            },
            {
                userId: user.id,
                kind: "dispute.filed",
                title: "Dispute submitted",
                body: `We received your dispute for transfer ${transferId.slice(0, 8)}…`,
                relatedEntityType: "dispute",
                relatedEntityId: d.id,
            }
        );
        res.status(201).json({ dispute: serializeDispute(d) });
    } catch (err) {
        next(translate(err));
    }
});

transferCustomerRouter.get("/disputes", (req, res, next) => {
    try {
        const user = req.user!;
        const list = listDisputes({ disputes: container.repos.disputes }, user.id);
        res.json({ disputes: list.map(serializeDispute) });
    } catch (err) {
        next(err);
    }
});

transferCustomerRouter.get("/recent", (req, res, next) => {
    try {
        const user = req.user!;
        const accountId = req.query.accountId;
        if (!isUuid(accountId)) return next(new BadRequestError("Invalid accountId"));
        const acc = container.repos.accounts.findById(accountId);
        if (!acc || acc.userId !== user.id) return next(new NotFoundError("Account not found"));
        const entries = container.repos.ledger.listByAccountId(acc.id, 50);
        res.json({ entries: entries.map(serializeLedger) });
    } catch (err) {
        next(err);
    }
});

/** GET /transfer/mine — list of transfers touching any account owned by caller. */
transferCustomerRouter.get("/mine", (req, res, next) => {
    try {
        const user = req.user!;
        const myAccounts = container.repos.accounts.listByUserId(user.id);
        const myAccountIds = new Set(myAccounts.map((a) => a.id));
        if (myAccountIds.size === 0) return res.json({ transfers: [] });
        const all = container.repos.transfers.list(500);
        const mine = all.filter(
            (t) =>
                (t.fromAccountId && myAccountIds.has(t.fromAccountId)) ||
                (t.toAccountId && myAccountIds.has(t.toAccountId))
        );
        res.json({ transfers: mine.map(serialize) });
    } catch (err) {
        next(err);
    }
});

/** GET /transfer/:id — full receipt with both ledger entries; ownership-checked. */
transferCustomerRouter.get("/:id", (req, res, next) => {
    try {
        const user = req.user!;
        const id = req.params.id;
        if (!isUuid(id)) return next(new BadRequestError("Invalid transfer id"));
        const transfer = container.repos.transfers.findById(id);
        if (!transfer) return next(new NotFoundError("Transfer not found"));

        const owns =
            user.role === "admin" ||
            (transfer.fromAccountId &&
                container.repos.accounts.findById(transfer.fromAccountId)?.userId === user.id) ||
            (transfer.toAccountId &&
                container.repos.accounts.findById(transfer.toAccountId)?.userId === user.id);
        if (!owns) return next(new ForbiddenError("Not your transfer"));

        const entries = container.repos.ledger.listByTransferId(transfer.id);
        res.json({
            transfer: serialize(transfer),
            entries: entries.map(serializeLedger),
        });
    } catch (err) {
        next(err);
    }
});

transactionsAdminRouter.get(
    "/",
    auditMiddleware(AuditActions.AdminTransactionsListed),
    (_req, res, next) => {
        try {
            const ts = container.repos.transfers.list(200);
            res.json({ transfers: ts.map(serialize) });
        } catch (err) {
            next(err);
        }
    }
);

faucetAdminRouter.post(
    "/",
    auditMiddleware(AuditActions.AdminFaucetIssued),
    requireStepUp("faucet"),
    (req, res, next) => {
    try {
        const body = (req.body || {}) as Record<string, unknown>;
        const toAccountId = body.toAccountId;
        const amountMinor = body.amountMinor;
        const memo = body.memo;
        const idempotencyKey = body.idempotencyKey;
        const skipMakerChecker = body.skipMakerChecker === true;
        if (!isUuid(toAccountId)) return next(new BadRequestError("Invalid toAccountId"));
        if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor <= 0)
            return next(new BadRequestError("Invalid amountMinor"));
        if (memo !== undefined && (typeof memo !== "string" || memo.length > 256))
            return next(new BadRequestError("Invalid memo"));
        if (idempotencyKey !== undefined && !isNonEmptyString(idempotencyKey, 128))
            return next(new BadRequestError("Invalid idempotencyKey"));

        const admin = req.user!;
        if (requiresMakerChecker(amountMinor) && !skipMakerChecker) {
            const pending = createPendingAction(
                container.db,
                { ids: container.ids, clock: container.clock },
                {
                    action: "admin.faucet",
                    requestedByUserId: admin.id,
                    payload: { toAccountId, amountMinor, memo, idempotencyKey },
                }
            );
            return res.status(202).json({ pendingAction: pending });
        }

        const transfer = faucetDeposit(
            {
                db: container.db,
                clock: container.clock,
                ids: container.ids,
                bus: container.bus,
            },
            {
                toAccountId,
                amountMinor,
                currency: "INR",
                memo: memo as string | undefined,
                idempotencyKey: idempotencyKey as string | undefined,
            }
        );
        res.json({ transfer: serialize(transfer) });
    } catch (err) {
        next(translate(err));
    }
});

transactionsAdminRouter.get("/disputes", (_req, res, next) => {
    try {
        const list = container.repos.disputes.listAll(200);
        res.json({ disputes: list.map(serializeDispute) });
    } catch (err) {
        next(err);
    }
});

transactionsAdminRouter.post("/disputes/:id/decide", (req, res, next) => {
    try {
        const admin = req.user!;
        const { id } = req.params;
        const body = (req.body || {}) as Record<string, unknown>;
        const approve = body.approve === true;
        const adminNote = body.adminNote;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        if (adminNote !== undefined && adminNote !== null && typeof adminNote !== "string")
            return next(new BadRequestError("Invalid adminNote"));
        const d = decideDispute(
            {
                db: container.db,
                disputes: container.repos.disputes,
                transfers: container.repos.transfers,
                clock: container.clock,
                ids: container.ids,
                bus: container.bus,
            },
            {
                disputeId: id,
                adminUserId: admin.id,
                approve,
                adminNote: typeof adminNote === "string" ? adminNote : undefined,
            }
        );
        emitNotification(
            {
                repo: container.repos.notifications,
                ids: container.ids,
                clock: container.clock,
            },
            {
                userId: d.userId,
                kind: "dispute.decided",
                title: approve ? "Dispute approved" : "Dispute rejected",
                body: approve
                    ? "Your dispute was approved. Funds may be reversed if applicable."
                    : "Your dispute was reviewed and rejected.",
                relatedEntityType: "dispute",
                relatedEntityId: d.id,
            }
        );
        res.json({ dispute: serializeDispute(d) });
    } catch (err) {
        next(translate(err));
    }
});

transactionsAdminRouter.get("/pending-actions", (_req, res, next) => {
    try {
        const list = listPendingActions(container.db);
        res.json({ pendingActions: list });
    } catch (err) {
        next(err);
    }
});

transactionsAdminRouter.post("/pending-actions/:id/approve", (req, res, next) => {
    try {
        const admin = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        const pending = approvePendingAction(container.db, { clock: container.clock }, {
            id,
            approvedByUserId: admin.id,
        });
        if (!pending) return next(new NotFoundError("Pending action not found"));
        if (pending.action === "admin.faucet") {
            const payload = JSON.parse(pending.payload) as {
                toAccountId: string;
                amountMinor: number;
                memo?: string;
                idempotencyKey?: string;
            };
            const transfer = faucetDeposit(
                {
                    db: container.db,
                    clock: container.clock,
                    ids: container.ids,
                    bus: container.bus,
                },
                {
                    toAccountId: payload.toAccountId,
                    amountMinor: payload.amountMinor,
                    currency: "INR",
                    memo: payload.memo,
                    idempotencyKey: payload.idempotencyKey,
                }
            );
            markPendingExecuted(container.db, pending.id);
            return res.json({ pendingAction: pending, transfer: serialize(transfer) });
        }
        res.json({ pendingAction: pending });
    } catch (err) {
        next(translate(err));
    }
});

function serialize(t: ReturnType<typeof container.repos.transfers.findById>) {
    if (!t) return null;
    return {
        id: t.id,
        idempotencyKey: t.idempotencyKey,
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        amountMinor: t.amountMinor,
        currency: t.currency,
        memo: t.memo,
        kind: t.kind,
        status: t.status,
        rail: t.rail,
        utr: t.utr,
        failureReason: t.failureReason,
        postedAt: t.postedAt.toISOString(),
        referenceNumber: t.referenceNumber,
        feeMinor: t.feeMinor,
        category: t.category,
        fromAccountNumber: t.fromAccountNumber,
        toAccountNumber: t.toAccountNumber,
        fromUsername: t.fromUsername,
        toUsername: t.toUsername,
        description: t.description,
        billerId: t.billerId,
    };
}

function serializeLedger(e: ReturnType<typeof container.repos.ledger.listByAccountId>[number]) {
    return {
        id: e.id,
        accountId: e.accountId,
        transferId: e.transferId,
        kind: e.kind,
        amountMinor: e.amountMinor,
        runningBalanceMinor: e.runningBalanceMinor,
        postedAt: e.postedAt.toISOString(),
    };
}

function serializeDispute(d: ReturnType<typeof container.repos.disputes.findById>) {
    if (!d) return null;
    return {
        id: d.id,
        userId: d.userId,
        transferId: d.transferId,
        reason: d.reason,
        status: d.status,
        adminNote: d.adminNote,
        reversalTransferId: d.reversalTransferId,
        createdAt: d.createdAt.toISOString(),
        decidedAt: d.decidedAt?.toISOString(),
    };
}

function translate(err: unknown): unknown {
    return composeDomainErrorTranslation(err, translateDisputePlainError);
}
