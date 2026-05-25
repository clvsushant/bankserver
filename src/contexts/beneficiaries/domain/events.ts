export interface BeneficiaryAddedEvent {
    readonly type: "BeneficiaryAdded";
    readonly beneficiaryId: string;
    readonly ownerUserId: string;
    readonly accountNumber: string;
    readonly nickname: string;
    readonly addedAt: Date;
}

export interface BeneficiaryRenamedEvent {
    readonly type: "BeneficiaryRenamed";
    readonly beneficiaryId: string;
    readonly ownerUserId: string;
    readonly oldNickname: string;
    readonly newNickname: string;
    readonly renamedAt: Date;
}

export interface BeneficiaryRemovedEvent {
    readonly type: "BeneficiaryRemoved";
    readonly beneficiaryId: string;
    readonly ownerUserId: string;
    readonly accountNumber: string;
    readonly removedAt: Date;
}

export type BeneficiaryEvent =
    | BeneficiaryAddedEvent
    | BeneficiaryRenamedEvent
    | BeneficiaryRemovedEvent;
