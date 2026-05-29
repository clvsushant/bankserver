export class CardNotFoundError extends Error {
    constructor() {
        super("Card not found");
    }
}

export class CardInvalidStateError extends Error {
    constructor(from: string, to: string) {
        super(`Cannot transition card from ${from} to ${to}`);
    }
}

export class CardLimitExceededError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class CardPerTxnLimitError extends Error {
    constructor() {
        super("Per-transaction card limit exceeded");
    }
}

export class CardLimitAboveBankMaxError extends Error {
    constructor(field: string) {
        super(`Card ${field} exceeds the bank maximum for your KYC tier`);
    }
}

export class CardMerchantNotConfiguredError extends Error {
    constructor() {
        super("Card merchant settlement account is not configured");
    }
}
