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
    cancelCard,
    freezeCard,
    issueCard,
    setCardLimits,
    unfreezeCard,
} from "../application/manageCards";
import { CardNotFoundError } from "../domain/errors";
import { simulateCardSpend } from "../application/simulateCardSpend";
import { previewCardLimits } from "../../../services/cardLimits";
import { getKycTier } from "../../identity/application/kycTier";
import { bankMaxForTier } from "../../../services/cardLimits";
import { composeDomainErrorTranslation, translateCardDomainError } from "../../../shared/domainErrorTranslate";

export const cardsRouter = express.Router();

const ALLOWED_NETWORKS = ["visa", "mastercard", "rupay"] as const;

cardsRouter.get("/mine", (req, res, next) => {
    try {
        const user = req.user!;
        const myAccounts = container.repos.accounts.listByUserId(user.id);
        const cards = myAccounts.flatMap((a) =>
            container.repos.cards
                .listByAccount(a.id)
                .map((c) => ({ ...serialize(c), accountNumber: a.accountNumber }))
        );
        res.json({ cards });
    } catch (err) {
        next(err);
    }
});

cardsRouter.get("/:id/limits", (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        const card = mustOwnCard(user.id, id);
        const preview = previewCardLimits(container.db, {
            cardId: card.id,
            limits: {
                perTxnLimitMinor: card.perTxnLimitMinor,
                dailyLimitMinor: card.dailyLimitMinor,
                monthlyLimitMinor: card.monthlyLimitMinor,
            },
            now: container.clock.now(),
        });
        const kycTier = getKycTier({ users: container.repos.users }, user.id);
        res.json({ limits: preview, bankMax: bankMaxForTier(kycTier), kycTier });
    } catch (err) {
        next(translate(err));
    }
});

cardsRouter.post(
    "/",
    requireStepUp("card.issue"),
    auditMiddleware(AuditActions.CardIssued),
    (req, res, next) => {
    try {
        const user = req.user!;
        const body = (req.body || {}) as Record<string, unknown>;
        const accountId = body.accountId;
        const network = body.network;
        if (!isUuid(accountId)) return next(new BadRequestError("Invalid accountId"));
        if (
            network !== undefined &&
            (typeof network !== "string" || !ALLOWED_NETWORKS.includes(network as never))
        )
            return next(new BadRequestError("Invalid network"));

        const card = issueCard(
            {
                repo: container.repos.cards,
                accounts: container.repos.accounts,
                users: container.repos.users,
                ids: container.ids,
                clock: container.clock,
            },
            {
                ownerUserId: user.id,
                accountId,
                network: typeof network === "string"
                    ? (network as "visa" | "mastercard" | "rupay")
                    : undefined,
            }
        );
        container.bus.publish([
            {
                type: "DebitCardIssued",
                cardId: card.id,
                ownerUserId: user.id,
                accountId: card.accountId,
                maskedNumber: card.maskedNumber,
                issuedAt: card.issuedAt,
            } as unknown as { type: string },
        ]);
        res.status(201).json({ card: serialize(card) });
    } catch (err) {
        next(translate(err));
    }
});

cardsRouter.post(
    "/:id/limits",
    requireStepUp("card.limits.update"),
    auditMiddleware(AuditActions.CardLimitsUpdated, {
        target: (req) =>
            req.params.id ? { type: "debit_card", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        const body = (req.body || {}) as Record<string, unknown>;
        const perTxnLimitMinor = body.perTxnLimitMinor;
        const dailyLimitMinor = body.dailyLimitMinor;
        const monthlyLimitMinor = body.monthlyLimitMinor;

        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        if (
            typeof perTxnLimitMinor !== "number" ||
            !Number.isInteger(perTxnLimitMinor) ||
            perTxnLimitMinor <= 0
        )
            return next(new BadRequestError("Invalid perTxnLimitMinor"));
        if (
            typeof dailyLimitMinor !== "number" ||
            !Number.isInteger(dailyLimitMinor) ||
            dailyLimitMinor <= 0
        )
            return next(new BadRequestError("Invalid dailyLimitMinor"));
        if (
            typeof monthlyLimitMinor !== "number" ||
            !Number.isInteger(monthlyLimitMinor) ||
            monthlyLimitMinor <= 0
        )
            return next(new BadRequestError("Invalid monthlyLimitMinor"));

        const card = setCardLimits(
            {
                repo: container.repos.cards,
                accounts: container.repos.accounts,
                users: container.repos.users,
                clock: container.clock,
            },
            {
                ownerUserId: user.id,
                cardId: id,
                perTxnLimitMinor,
                dailyLimitMinor,
                monthlyLimitMinor,
            }
        );
        res.json({ card: serialize(card) });
    } catch (err) {
        next(translate(err));
    }
});

cardsRouter.post(
    "/:id/spend",
    requireStepUp("card.spend"),
    auditMiddleware(AuditActions.CardSpent, {
        target: (req) =>
            req.params.id ? { type: "debit_card", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        const body = (req.body || {}) as Record<string, unknown>;
        const amountMinor = body.amountMinor;
        const merchantName = body.merchantName;
        const idempotencyKey = body.idempotencyKey;

        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor <= 0)
            return next(new BadRequestError("Invalid amountMinor"));
        if (
            merchantName !== undefined &&
            merchantName !== null &&
            !isNonEmptyString(merchantName, 128)
        )
            return next(new BadRequestError("Invalid merchantName"));
        if (
            idempotencyKey !== undefined &&
            idempotencyKey !== null &&
            !isNonEmptyString(idempotencyKey, 128)
        )
            return next(new BadRequestError("Invalid idempotencyKey"));

        const transfer = simulateCardSpend(
            {
                db: container.db,
                clock: container.clock,
                ids: container.ids,
                bus: container.bus,
                cards: container.repos.cards,
                accounts: container.repos.accounts,
                billers: container.repos.billers,
            },
            {
                ownerUserId: user.id,
                cardId: id,
                amountMinor,
                currency: "INR",
                merchantName: typeof merchantName === "string" ? merchantName : undefined,
                idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : undefined,
            }
        );
        res.json({
            transfer: {
                id: transfer.id,
                referenceNumber: transfer.referenceNumber,
                amountMinor: transfer.amountMinor,
                description: transfer.description,
            },
        });
    } catch (err) {
        next(translate(err));
    }
});

cardsRouter.post(
    "/:id/freeze",
    requireStepUp("card.update"),
    auditMiddleware(AuditActions.CardFrozen, {
        target: (req) =>
            req.params.id ? { type: "debit_card", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        const card = freezeCard(
            {
                repo: container.repos.cards,
                accounts: container.repos.accounts,
                clock: container.clock,
            },
            { ownerUserId: user.id, cardId: id }
        );
        container.bus.publish([
            {
                type: "DebitCardFrozen",
                cardId: card.id,
                ownerUserId: user.id,
                maskedNumber: card.maskedNumber,
                frozenAt: card.frozenAt,
            } as unknown as { type: string },
        ]);
        res.json({ card: serialize(card) });
    } catch (err) {
        next(translate(err));
    }
});

cardsRouter.post("/:id/unfreeze", requireStepUp("card.update"), (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        const card = unfreezeCard(
            {
                repo: container.repos.cards,
                accounts: container.repos.accounts,
                clock: container.clock,
            },
            { ownerUserId: user.id, cardId: id }
        );
        res.json({ card: serialize(card) });
    } catch (err) {
        next(translate(err));
    }
});

cardsRouter.post(
    "/:id/cancel",
    requireStepUp("card.cancel"),
    auditMiddleware(AuditActions.CardCancelled, {
        target: (req) =>
            req.params.id ? { type: "debit_card", id: req.params.id } : null,
    }),
    (req, res, next) => {
    try {
        const user = req.user!;
        const { id } = req.params;
        if (!isUuid(id)) return next(new BadRequestError("Invalid id"));
        const card = cancelCard(
            {
                repo: container.repos.cards,
                accounts: container.repos.accounts,
                clock: container.clock,
            },
            { ownerUserId: user.id, cardId: id }
        );
        container.bus.publish([
            {
                type: "DebitCardCancelled",
                cardId: card.id,
                ownerUserId: user.id,
                maskedNumber: card.maskedNumber,
                cancelledAt: card.cancelledAt,
            } as unknown as { type: string },
        ]);
        res.json({ card: serialize(card) });
    } catch (err) {
        next(translate(err));
    }
});

function mustOwnCard(ownerUserId: string, cardId: string) {
    const card = container.repos.cards.findById(cardId);
    if (!card) throw new CardNotFoundError();
    const account = container.repos.accounts.findById(card.accountId);
    if (!account || account.userId !== ownerUserId) throw new CardNotFoundError();
    return card;
}

function serialize(c: ReturnType<typeof container.repos.cards.findById>) {
    if (!c) return null;
    return {
        id: c.id,
        accountId: c.accountId,
        maskedNumber: c.maskedNumber,
        network: c.network,
        status: c.status,
        issuedAt: c.issuedAt.toISOString(),
        frozenAt: c.frozenAt?.toISOString(),
        cancelledAt: c.cancelledAt?.toISOString(),
        perTxnLimitMinor: c.perTxnLimitMinor,
        dailyLimitMinor: c.dailyLimitMinor,
        monthlyLimitMinor: c.monthlyLimitMinor,
    };
}

function translate(err: unknown): unknown {
    return composeDomainErrorTranslation(err, translateCardDomainError);
}
