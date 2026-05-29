export class TransferToSelfError extends Error {
    constructor() {
        super("Cannot transfer to the same account");
    }
}

export class TransferAmountInvalidError extends Error {
    constructor() {
        super("Transfer amount must be > 0");
    }
}

export class TransferOverLimitError extends Error {
    constructor(maxMinor: number) {
        super(`Transfer amount exceeds per-transaction limit (${maxMinor} minor)`);
    }
}

/**
 * Funding someone else's Fixed Deposit is not allowed: any transfer whose
 * destination is a fixed_deposit account is only permitted when the source
 * and destination belong to the same user (i.e. you may park your own money
 * into your own FD, but you cannot push money into another customer's FD).
 */
export class CrossUserFixedDepositTransferError extends Error {
    constructor() {
        super(
            "Transfers into a Fixed Deposit are only allowed between your own accounts"
        );
    }
}

export class TransferAggregateLimitError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class InvalidUpiVpaError extends Error {
    constructor() {
        super("Invalid UPI VPA");
    }
}
