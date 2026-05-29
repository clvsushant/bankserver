export type NotificationKind =
    | "kyc.approved"
    | "kyc.rejected"
    | "transfer.sent"
    | "transfer.received"
    | "standing.executed"
    | "password.changed"
    | "passkey.revoked"
    | "card.frozen"
    | "card.issued"
    | "card.spent"
    | "dispute.filed"
    | "dispute.decided"
    | "standing.failed";

export interface Notification {
    readonly id: string;
    readonly userId: string;
    readonly kind: NotificationKind;
    readonly title: string;
    readonly body: string;
    readAt?: Date;
    readonly relatedEntityType?: string;
    readonly relatedEntityId?: string;
    readonly createdAt: Date;
}

export function createNotification(input: {
    id: string;
    userId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
    createdAt: Date;
}): Notification {
    return {
        id: input.id,
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        createdAt: input.createdAt,
    };
}
