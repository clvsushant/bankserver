/**
 * Tiny composition root. Wires the production DB + clock + id generator +
 * event bus + repos so route modules can `import { container } from
 * "../container"`. Tests build their own container with stub deps.
 *
 * Keeping this here (rather than a full DI library) is enough for a sample
 * — the contexts themselves are framework-agnostic and depend on the port
 * interfaces in their `application/ports.ts`.
 */

import { db } from "./db/client";
import { systemClock } from "./shared/clock";
import { systemIds } from "./shared/ids";
import { bus } from "./shared/eventBus";
import { makeUserRepo } from "./contexts/identity/infrastructure/userRepo";
import { makeCredentialRepo } from "./contexts/identity/infrastructure/credentialRepo";
import { makeRecoveryCodeRepo } from "./contexts/identity/infrastructure/recoveryCodeRepo";
import { makeKycRepo } from "./contexts/kyc/infrastructure/kycRepo";
import { makeAccountRepo } from "./contexts/accounts/infrastructure/accountRepo";
import { createAccountForUser } from "./contexts/accounts/application/createAccount";
import { makeTransferRepo } from "./contexts/payments/infrastructure/transferRepo";
import { makeLedgerRepo } from "./contexts/payments/infrastructure/ledgerRepo";
import { makeBeneficiaryRepo } from "./contexts/beneficiaries/infrastructure/beneficiaryRepo";
import { makeBillerRepo } from "./contexts/bills/infrastructure/billerRepo";
import { makeStandingInstructionRepo } from "./contexts/standingInstructions/infrastructure/standingInstructionRepo";
import { makeNotificationRepo } from "./contexts/notifications/infrastructure/notificationRepo";
import { makeDebitCardRepo } from "./contexts/cards/infrastructure/debitCardRepo";
import { makeAuditRepo } from "./contexts/audit/infrastructure/auditRepo";
import { recordAudit } from "./contexts/audit/application/recordAudit";
import { fromBusEvent } from "./contexts/audit/application/fromBusEvent";
import { stubOtpDelivery, type OtpDeliveryProvider } from "./services/otpDelivery";
import type { KycApprovedEvent, KycRejectedEvent } from "./contexts/kyc/domain/events";
import type { MoneyMovedEvent } from "./contexts/payments/domain/events";
import { emitNotification } from "./contexts/notifications/application/createNotification";
import { inrFmtMinor } from "./shared/money";

// Default to the stub provider; real-email rollout swaps this for an SMTP
// (or SES, etc.) implementation. Everything else stays the same.
const otpDelivery: OtpDeliveryProvider = stubOtpDelivery;

export const container = {
    db,
    clock: systemClock,
    ids: systemIds,
    bus,
    otpDelivery,
    repos: {
        users: makeUserRepo(db),
        credentials: makeCredentialRepo(db),
        recoveryCodes: makeRecoveryCodeRepo(db),
        kyc: makeKycRepo(db),
        accounts: makeAccountRepo(db),
        transfers: makeTransferRepo(db),
        ledger: makeLedgerRepo(db),
        beneficiaries: makeBeneficiaryRepo(db),
        billers: makeBillerRepo(db),
        standingInstructions: makeStandingInstructionRepo(db),
        notifications: makeNotificationRepo(db),
        cards: makeDebitCardRepo(db),
        audit: makeAuditRepo(db),
    },
};

// Wildcard audit subscriber. Every domain event published on the bus is
// translated into an audit row via `fromBusEvent`. Unknown event types
// silently fall through (the mapper returns null) so adding a new event
// elsewhere never crashes the audit pipeline.
container.bus.subscribeAll((event) => {
    const input = fromBusEvent(event);
    if (!input) return;
    recordAudit(
        {
            repo: container.repos.audit,
            clock: container.clock,
            ids: container.ids,
        },
        input
    );
});

// Wire cross-context subscribers. Synchronous in-process bus: the KYC use
// case publishes after its UPDATE; this subscriber inserts an Account in
// the same logical step. (For multi-row atomicity with the KYC update,
// upgrade to a SQL transaction wrapper around both.)
container.bus.subscribe<KycApprovedEvent>("KycApproved", (event) => {
    // Open the account of the type the customer requested at KYC submission.
    const application = container.repos.kyc.findById(event.applicationId);
    const requestedType = application?.requestedAccountType ?? "savings";
    createAccountForUser(
        {
            repo: container.repos.accounts,
            ids: container.ids,
            clock: container.clock,
            bus: container.bus,
        },
        event.userId,
        requestedType
    );
    emitNotification(
        { repo: container.repos.notifications, ids: container.ids, clock: container.clock },
        {
            userId: event.userId,
            kind: "kyc.approved",
            title: "KYC approved",
            body: `Your KYC has been approved and a ${requestedType.replace("_", " ")} account is ready.`,
            relatedEntityType: "kyc",
            relatedEntityId: event.applicationId,
        }
    );
});

container.bus.subscribe<KycRejectedEvent>("KycRejected", (event) => {
    emitNotification(
        { repo: container.repos.notifications, ids: container.ids, clock: container.clock },
        {
            userId: event.userId,
            kind: "kyc.rejected",
            title: "KYC rejected",
            body: `Reason: ${event.reason}. You can re-apply with corrected details.`,
            relatedEntityType: "kyc",
            relatedEntityId: event.applicationId,
        }
    );
});

container.bus.subscribe<MoneyMovedEvent>("MoneyMoved", (event) => {
    // Look up the (already-committed) transfer for the receipt details.
    const t = container.repos.transfers.findById(event.transferId);
    if (!t) return;
    const amount = inrFmtMinor(event.amountMinor);
    const description = t.description ?? "";

    if (t.fromAccountId) {
        const debitor = container.repos.accounts.findById(t.fromAccountId);
        if (debitor) {
            emitNotification(
                {
                    repo: container.repos.notifications,
                    ids: container.ids,
                    clock: container.clock,
                },
                {
                    userId: debitor.userId,
                    kind: "transfer.sent",
                    title: `${amount} sent`,
                    body: description || `Sent ${amount}`,
                    relatedEntityType: "transfer",
                    relatedEntityId: t.id,
                }
            );
        }
    }
    if (t.toAccountId) {
        const creditor = container.repos.accounts.findById(t.toAccountId);
        if (creditor) {
            emitNotification(
                {
                    repo: container.repos.notifications,
                    ids: container.ids,
                    clock: container.clock,
                },
                {
                    userId: creditor.userId,
                    kind: "transfer.received",
                    title: `${amount} received`,
                    body: description || `Received ${amount}`,
                    relatedEntityType: "transfer",
                    relatedEntityId: t.id,
                }
            );
        }
    }
});

interface PasswordChangedEvent {
    type: "PasswordChanged";
    userId: string;
    username: string;
    changedAt: Date;
}
container.bus.subscribe<PasswordChangedEvent>("PasswordChanged", (event) => {
    emitNotification(
        { repo: container.repos.notifications, ids: container.ids, clock: container.clock },
        {
            userId: event.userId,
            kind: "password.changed",
            title: "Password changed",
            body: "Your sign-in password was changed. If this wasn't you, contact an admin.",
        }
    );
});

interface PasskeyRevokedEvent {
    type: "PasskeyRevoked";
    userId: string;
    credentialId: string;
    revokedAt: Date;
}
container.bus.subscribe<PasskeyRevokedEvent>("PasskeyRevoked", (event) => {
    emitNotification(
        { repo: container.repos.notifications, ids: container.ids, clock: container.clock },
        {
            userId: event.userId,
            kind: "passkey.revoked",
            title: "Passkey revoked",
            body: `A passkey ending in ${event.credentialId.slice(-6)} was revoked from your account.`,
        }
    );
});

interface DebitCardIssuedEvent {
    type: "DebitCardIssued";
    cardId: string;
    ownerUserId: string;
    accountId: string;
    maskedNumber: string;
    issuedAt: Date;
}
container.bus.subscribe<DebitCardIssuedEvent>("DebitCardIssued", (event) => {
    emitNotification(
        { repo: container.repos.notifications, ids: container.ids, clock: container.clock },
        {
            userId: event.ownerUserId,
            kind: "card.issued",
            title: "Debit card issued",
            body: `Your card ${event.maskedNumber} is active.`,
            relatedEntityType: "card",
            relatedEntityId: event.cardId,
        }
    );
});

interface DebitCardFrozenEvent {
    type: "DebitCardFrozen";
    cardId: string;
    ownerUserId: string;
    maskedNumber: string;
    frozenAt: Date;
}
container.bus.subscribe<DebitCardFrozenEvent>("DebitCardFrozen", (event) => {
    emitNotification(
        { repo: container.repos.notifications, ids: container.ids, clock: container.clock },
        {
            userId: event.ownerUserId,
            kind: "card.frozen",
            title: "Debit card frozen",
            body: `Card ${event.maskedNumber} is now frozen.`,
            relatedEntityType: "card",
            relatedEntityId: event.cardId,
        }
    );
});

interface StandingInstructionRanEvent {
    type: "StandingInstructionRan";
    siId: string;
    ownerUserId: string;
    amountMinor: number;
    beneficiaryAccountNumber: string;
    ranAt: Date;
}
container.bus.subscribe<StandingInstructionRanEvent>("StandingInstructionRan", (event) => {
    emitNotification(
        { repo: container.repos.notifications, ids: container.ids, clock: container.clock },
        {
            userId: event.ownerUserId,
            kind: "standing.executed",
            title: "Standing instruction ran",
            body: `${inrFmtMinor(event.amountMinor)} sent to ${event.beneficiaryAccountNumber}.`,
            relatedEntityType: "standing_instruction",
            relatedEntityId: event.siId,
        }
    );
});

export type Container = typeof container;
