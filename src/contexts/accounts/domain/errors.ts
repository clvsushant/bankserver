export class AccountNotFoundError extends Error {
    constructor() {
        super("Account not found");
    }
}

export class AccountNotActiveError extends Error {
    constructor() {
        super("Account is not active");
    }
}

export class AccountInvalidStatusTransitionError extends Error {
    constructor(from: string, to: string) {
        super(`Invalid account status transition: ${from} -> ${to}`);
    }
}

export class AccountCloseRequiresZeroBalanceError extends Error {
    constructor() {
        super("Cannot close account with non-zero balance");
    }
}

export class InsufficientFundsError extends Error {
    constructor() {
        super("Insufficient funds");
    }
}

export class CurrencyMismatchError extends Error {
    constructor() {
        super("Currency mismatch");
    }
}
