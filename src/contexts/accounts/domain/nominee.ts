export interface Nominee {
    readonly id: string;
    readonly accountId: string;
    readonly userId: string;
    readonly fullName: string;
    readonly relation: string;
    readonly sharePercent: number;
    readonly createdAt: Date;
}

export function createNominee(input: {
    id: string;
    accountId: string;
    userId: string;
    fullName: string;
    relation: string;
    sharePercent?: number;
    createdAt: Date;
}): Nominee {
    const fullName = input.fullName.trim();
    const relation = input.relation.trim();
    if (!fullName) throw new Error("Nominee name required");
    if (!relation) throw new Error("Relation required");
    const share = input.sharePercent ?? 100;
    if (share < 1 || share > 100) throw new Error("Share percent must be 1-100");
    return {
        id: input.id,
        accountId: input.accountId,
        userId: input.userId,
        fullName,
        relation,
        sharePercent: share,
        createdAt: input.createdAt,
    };
}
