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

export class AccountCloseBlockedError extends Error {
    constructor(reason: string) {
        super(`Cannot close account: ${reason}`);
    }
}

export class InsufficientFundsError extends Error {
    constructor() {
        super("Insufficient funds");
    }
}

export class InsufficientAvailableFundsError extends Error {
    constructor() {
        super("Insufficient available balance");
    }
}

export class MinimumBalanceViolationError extends Error {
    readonly minBalanceMinor: number;
    constructor(minBalanceMinor: number) {
        super(`Debit would breach minimum balance of ${minBalanceMinor} paise`);
        this.minBalanceMinor = minBalanceMinor;
    }
}

export class HoldExceedsBalanceError extends Error {
    constructor() {
        super("Hold amount exceeds account balance");
    }
}

export class FixedDepositWithdrawalBlockedError extends Error {
    constructor() {
        super("Fixed deposit principal cannot be withdrawn via transfer; use premature closure or wait for maturity");
    }
}

export class CurrencyMismatchError extends Error {
    constructor() {
        super("Currency mismatch");
    }
}

export class FdMinimumPrincipalError extends Error {
    constructor() {
        super("FD minimum principal not met");
    }
}

export class FdInvalidTenureError extends Error {
    constructor() {
        super("Invalid FD tenure");
    }
}

export class FdUnsupportedTenureError extends Error {
    constructor() {
        super("Unsupported FD tenure");
    }
}

export class NomineeNameRequiredError extends Error {
    constructor() {
        super("Nominee name required");
    }
}

export class NomineeRelationRequiredError extends Error {
    constructor() {
        super("Relation required");
    }
}

export class NomineeShareInvalidError extends Error {
    constructor() {
        super("Share percent must be 1-100");
    }
}
