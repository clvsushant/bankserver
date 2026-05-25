/**
 * Translate a bus event into the input shape expected by `recordAudit`.
 *
 * This is the *single* place that knows about specific event types, which
 * keeps the wildcard subscriber in `container.ts` trivial.
 *
 * Unknown types map to `null` so the subscriber simply drops them — the
 * audit context never crashes on a new domain event it hasn't been taught
 * about yet.
 */

import type { DomainEvent } from "../../../shared/eventBus";
import { AuditActions, type AuditAction } from "../domain/actions";
import type { RecordAuditInput } from "./recordAudit";

type EventToAction = Record<string, AuditAction>;

const ACTION_BY_EVENT: EventToAction = {
    KycSubmitted: AuditActions.KycSubmitted,
    KycApproved: AuditActions.KycApproved,
    KycRejected: AuditActions.KycRejected,

    MoneyMoved: AuditActions.TransferExecuted,
    BillPaid: AuditActions.BillPaid,

    AccountOpened: AuditActions.AccountOpened,
    AccountFrozen: AuditActions.AccountFrozen,
    AccountUnfrozen: AuditActions.AccountUnfrozen,
    AccountClosed: AuditActions.AccountClosed,

    BeneficiaryAdded: AuditActions.BeneficiaryAdded,
    BeneficiaryRenamed: AuditActions.BeneficiaryRenamed,
    BeneficiaryRemoved: AuditActions.BeneficiaryRemoved,

    StandingInstructionCreated: AuditActions.StandingInstructionCreated,
    StandingInstructionPaused: AuditActions.StandingInstructionPaused,
    StandingInstructionResumed: AuditActions.StandingInstructionResumed,
    StandingInstructionCancelled: AuditActions.StandingInstructionCancelled,
    StandingInstructionRan: AuditActions.StandingInstructionRan,

    DebitCardIssued: AuditActions.CardIssued,
    DebitCardFrozen: AuditActions.CardFrozen,
    DebitCardCancelled: AuditActions.CardCancelled,

    PasswordChanged: AuditActions.AuthPasswordChanged,
    PasskeyRevoked: AuditActions.AuthPasskeyRevoked,
    PasskeyEnrolledAdditional: AuditActions.AuthPasskeyEnrolledAdditional,
    RecoveryCodeIssued: AuditActions.AdminRecoveryCodeIssued,
    RecoveryCodeConsumed: AuditActions.AuthRecoveryConsumedSuccess,
};

interface EventActorOpts {
    actorUserId?: string;
    actorRole?: "customer" | "admin" | "system" | "anonymous";
    sessionId?: string;
    actorUsername?: string;
    requestId?: string;
}

/**
 * Map a single bus event to a RecordAuditInput, or `null` if the type is
 * unknown.
 *
 * The wildcard subscriber doesn't know anything about HTTP — actor / IP /
 * request id therefore default to "system". The subscriber may overlay
 * actor info if it has access to e.g. ALS-stored request context.
 */
export function fromBusEvent(
    event: DomainEvent,
    actor: EventActorOpts = {}
): RecordAuditInput | null {
    const action = ACTION_BY_EVENT[event.type];
    if (!action) return null;

    const e = event as unknown as Record<string, unknown>;

    const userId = pickString(e, ["userId", "ownerUserId", "actorUserId"]);
    const role = actor.actorRole ?? (userId ? "customer" : "system");

    const target = pickTarget(event.type, e);
    const summary = summaryFor(event.type, e);

    return {
        action,
        actor: {
            userId: actor.actorUserId ?? userId,
            username: actor.actorUsername,
            role,
        },
        sessionId: actor.sessionId,
        target,
        status: "success",
        summary,
        payload: e,
        requestId: actor.requestId,
        occurredAt: pickDate(e, ["postedAt", "decidedAt", "ranAt", "occurredAt"]),
    };
}

function pickString(o: Record<string, unknown>, keys: string[]): string | undefined {
    for (const k of keys) {
        const v = o[k];
        if (typeof v === "string") return v;
    }
    return undefined;
}

function pickDate(o: Record<string, unknown>, keys: string[]): Date | undefined {
    for (const k of keys) {
        const v = o[k];
        if (v instanceof Date) return v;
    }
    return undefined;
}

function pickTarget(
    type: string,
    e: Record<string, unknown>
): { type: string; id: string } | undefined {
    switch (type) {
        case "KycSubmitted":
        case "KycApproved":
        case "KycRejected": {
            const id = pickString(e, ["applicationId"]);
            return id ? { type: "kyc_application", id } : undefined;
        }
        case "MoneyMoved": {
            const id = pickString(e, ["transferId"]);
            return id ? { type: "transfer", id } : undefined;
        }
        case "BillPaid": {
            const id = pickString(e, ["transferId", "billerId"]);
            return id ? { type: "transfer", id } : undefined;
        }
        case "AccountOpened":
        case "AccountFrozen":
        case "AccountUnfrozen":
        case "AccountClosed": {
            const id = pickString(e, ["accountId"]);
            return id ? { type: "account", id } : undefined;
        }
        case "BeneficiaryAdded":
        case "BeneficiaryRenamed":
        case "BeneficiaryRemoved": {
            const id = pickString(e, ["beneficiaryId"]);
            return id ? { type: "beneficiary", id } : undefined;
        }
        case "StandingInstructionCreated":
        case "StandingInstructionPaused":
        case "StandingInstructionResumed":
        case "StandingInstructionCancelled":
        case "StandingInstructionRan": {
            const id = pickString(e, ["siId"]);
            return id ? { type: "standing_instruction", id } : undefined;
        }
        case "DebitCardIssued":
        case "DebitCardFrozen":
        case "DebitCardCancelled": {
            const id = pickString(e, ["cardId"]);
            return id ? { type: "debit_card", id } : undefined;
        }
        case "PasswordChanged":
        case "PasskeyRevoked":
        case "PasskeyEnrolledAdditional":
        case "RecoveryCodeIssued":
        case "RecoveryCodeConsumed": {
            const id = pickString(e, ["userId"]);
            return id ? { type: "user", id } : undefined;
        }
        default:
            return undefined;
    }
}

function summaryFor(type: string, e: Record<string, unknown>): string {
    switch (type) {
        case "MoneyMoved": {
            const amt = e.amountMinor;
            return typeof amt === "number"
                ? `Transfer of ${amt} minor units posted`
                : "Transfer posted";
        }
        case "BillPaid":
            return "Bill payment posted";
        case "KycSubmitted":
            return "KYC application submitted";
        case "KycApproved":
            return "KYC application approved";
        case "KycRejected":
            return `KYC application rejected${
                typeof e.reason === "string" ? `: ${e.reason}` : ""
            }`;
        case "AccountOpened":
            return "Account opened";
        case "AccountFrozen":
            return "Account frozen";
        case "AccountUnfrozen":
            return "Account unfrozen";
        case "AccountClosed":
            return "Account closed";
        case "BeneficiaryAdded":
            return "Beneficiary added";
        case "BeneficiaryRenamed":
            return "Beneficiary renamed";
        case "BeneficiaryRemoved":
            return "Beneficiary removed";
        case "StandingInstructionCreated":
            return "Standing instruction created";
        case "StandingInstructionPaused":
            return "Standing instruction paused";
        case "StandingInstructionResumed":
            return "Standing instruction resumed";
        case "StandingInstructionCancelled":
            return "Standing instruction cancelled";
        case "StandingInstructionRan":
            return "Standing instruction executed";
        case "DebitCardIssued":
            return "Debit card issued";
        case "DebitCardFrozen":
            return "Debit card frozen";
        case "DebitCardCancelled":
            return "Debit card cancelled";
        case "PasswordChanged":
            return "Password changed";
        case "PasskeyRevoked":
            return "Passkey revoked";
        case "PasskeyEnrolledAdditional":
            return "Additional passkey enrolled";
        case "RecoveryCodeIssued":
            return typeof e.username === "string"
                ? `Recovery code issued for ${e.username}`
                : "Recovery code issued";
        case "RecoveryCodeConsumed":
            return "Recovery code consumed";
        default:
            return type;
    }
}
