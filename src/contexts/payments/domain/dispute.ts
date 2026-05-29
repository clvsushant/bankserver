export type DisputeStatus = "submitted" | "under_review" | "approved" | "rejected";

export interface Dispute {
    readonly id: string;
    readonly userId: string;
    readonly transferId: string;
    readonly reason: string;
    status: DisputeStatus;
    adminNote?: string;
    reversalTransferId?: string;
    readonly createdAt: Date;
    decidedAt?: Date;
    decidedByUserId?: string;
}

export function createDispute(input: {
    id: string;
    userId: string;
    transferId: string;
    reason: string;
    createdAt: Date;
}): Dispute {
    const reason = input.reason.trim();
    if (!reason) throw new Error("Dispute reason required");
    return {
        id: input.id,
        userId: input.userId,
        transferId: input.transferId,
        reason,
        status: "submitted",
        createdAt: input.createdAt,
    };
}
