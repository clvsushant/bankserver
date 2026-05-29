export class DisputeTransferNotFoundError extends Error {
    constructor() {
        super("Transfer not found");
    }
}

export class DisputeNotAuthorizedError extends Error {
    constructor() {
        super("You can only dispute transfers involving your accounts");
    }
}

export class DisputeNotFoundError extends Error {
    constructor() {
        super("Dispute not found");
    }
}

export class DisputeAlreadyDecidedError extends Error {
    constructor() {
        super("Dispute already decided");
    }
}

export class DisputeReversalBlockedError extends Error {
    constructor(message: string) {
        super(message);
    }
}
