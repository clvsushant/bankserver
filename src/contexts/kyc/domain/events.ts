export interface KycSubmittedEvent {
    type: "KycSubmitted";
    userId: string;
    applicationId: string;
    submittedAt: Date;
}

export interface KycApprovedEvent {
    type: "KycApproved";
    userId: string;
    applicationId: string;
    decidedAt: Date;
}

export interface KycRejectedEvent {
    type: "KycRejected";
    userId: string;
    applicationId: string;
    reason: string;
    decidedAt: Date;
}

export type KycEvent = KycSubmittedEvent | KycApprovedEvent | KycRejectedEvent;
