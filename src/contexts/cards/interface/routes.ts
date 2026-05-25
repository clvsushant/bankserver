import express from "express";
import { container } from "../../../container";
import { isUuid } from "../../../utils/validate";
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
    unfreezeCard,
} from "../application/manageCards";
import { CardInvalidStateError, CardNotFoundError } from "../domain/errors";
import { AccountNotFoundError } from "../../accounts/domain/errors";

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
        // Re-publish a domain event for the notifications subscriber.
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
    };
}

function translate(err: unknown): unknown {
    if (err instanceof CardNotFoundError) return new NotFoundError(err.message);
    if (err instanceof CardInvalidStateError) return new ConflictError(err.message);
    if (err instanceof AccountNotFoundError) return new NotFoundError(err.message);
    if (err instanceof HttpError) return err;
    return err;
}
