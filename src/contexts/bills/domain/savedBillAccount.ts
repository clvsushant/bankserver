export interface SavedBillAccount {
    readonly id: string;
    readonly userId: string;
    readonly billerId: string;
    readonly customerRef: string;
    readonly nickname: string;
    readonly createdAt: Date;
}

export function createSavedBillAccount(input: {
    id: string;
    userId: string;
    billerId: string;
    customerRef: string;
    nickname: string;
    createdAt: Date;
}): SavedBillAccount {
    const customerRef = input.customerRef.trim();
    const nickname = input.nickname.trim();
    if (!customerRef) throw new Error("customerRef required");
    if (!nickname) throw new Error("nickname required");
    return {
        id: input.id,
        userId: input.userId,
        billerId: input.billerId,
        customerRef,
        nickname,
        createdAt: input.createdAt,
    };
}
