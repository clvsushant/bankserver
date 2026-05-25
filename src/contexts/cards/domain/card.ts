import crypto from "crypto";

export type CardNetwork = "visa" | "mastercard" | "rupay";
export type CardStatus = "active" | "frozen" | "cancelled";

export interface DebitCard {
    readonly id: string;
    readonly accountId: string;
    readonly maskedNumber: string;
    readonly network: CardNetwork;
    status: CardStatus;
    readonly issuedAt: Date;
    frozenAt?: Date;
    cancelledAt?: Date;
}

const NETWORK_PREFIX: Record<CardNetwork, string> = {
    visa: "4242",
    mastercard: "5454",
    rupay: "6080",
};

/**
 * Generates a cosmetic masked card number — last 4 random digits only.
 * No PAN handling, no Luhn computation. Format: PPPP-XXXX-XXXX-NNNN.
 */
export function generateMaskedNumber(network: CardNetwork): string {
    const prefix = NETWORK_PREFIX[network];
    const last4 = crypto.randomInt(0, 10_000).toString().padStart(4, "0");
    return `${prefix}-XXXX-XXXX-${last4}`;
}

export function createCard(input: {
    id: string;
    accountId: string;
    network: CardNetwork;
    issuedAt: Date;
    maskedNumber?: string;
}): DebitCard {
    return {
        id: input.id,
        accountId: input.accountId,
        maskedNumber: input.maskedNumber ?? generateMaskedNumber(input.network),
        network: input.network,
        status: "active",
        issuedAt: input.issuedAt,
    };
}
