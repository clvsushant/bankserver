export type BillerCategory =
    | "electricity"
    | "gas"
    | "water"
    | "internet"
    | "mobile"
    | "other";

export interface Biller {
    readonly id: string;
    readonly name: string;
    readonly category: BillerCategory;
    /** The bank-internal account that receives the customer's payment. */
    readonly billerAccountNumber: string;
    readonly active: boolean;
    readonly createdAt: Date;
}
