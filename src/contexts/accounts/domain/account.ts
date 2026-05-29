import type { Currency } from "../../../shared/money";
import {
    AccountInvalidStatusTransitionError,
    AccountCloseRequiresZeroBalanceError,
    AccountCloseBlockedError,
    InsufficientFundsError,
    InsufficientAvailableFundsError,
    MinimumBalanceViolationError,
    CurrencyMismatchError,
    AccountNotActiveError,
    HoldExceedsBalanceError,
    FixedDepositWithdrawalBlockedError,
} from "./errors";

export type AccountStatus = "Active" | "Frozen" | "Closed";
export type AccountType = "savings" | "current" | "fixed_deposit";

export const ACCOUNT_TYPES: ReadonlyArray<AccountType> = [
    "savings",
    "current",
    "fixed_deposit",
];

export interface AccountTypeMeta {
    readonly type: AccountType;
    readonly label: string;
    readonly description: string;
    /** Minimum balance that must remain after a debit (paise). */
    readonly minBalanceMinor: number;
}

export const ACCOUNT_TYPE_META: Record<AccountType, AccountTypeMeta> = {
    savings: {
        type: "savings",
        label: "Savings",
        description: "Everyday savings account. Minimum balance ₹500.",
        minBalanceMinor: 50_000,
    },
    current: {
        type: "current",
        label: "Current",
        description: "Business current account. Minimum balance ₹10,000.",
        minBalanceMinor: 1_000_000,
    },
    fixed_deposit: {
        type: "fixed_deposit",
        label: "Fixed Deposit",
        description:
            "Term deposit with locked principal. Withdraw only at maturity or via premature closure.",
        minBalanceMinor: 0,
    },
};

export function isAccountType(v: unknown): v is AccountType {
    return typeof v === "string" && (ACCOUNT_TYPES as readonly string[]).includes(v);
}

export function minBalanceForType(accountType: AccountType): number {
    return ACCOUNT_TYPE_META[accountType].minBalanceMinor;
}

export interface Account {
    readonly id: string;
    readonly accountNumber: string;
    readonly userId: string;
    readonly accountType: AccountType;
    status: AccountStatus;
    balanceMinor: number;
    holdBalanceMinor: number;
    currency: Currency;
    readonly createdAt: Date;
    updatedAt: Date;
}

export function availableBalanceMinor(account: Account): number {
    return account.balanceMinor - account.holdBalanceMinor;
}

export function open(input: {
    id: string;
    accountNumber: string;
    userId: string;
    accountType?: AccountType;
    currency?: Currency;
    createdAt: Date;
}): Account {
    return {
        id: input.id,
        accountNumber: input.accountNumber,
        userId: input.userId,
        accountType: input.accountType ?? "savings",
        status: "Active",
        balanceMinor: 0,
        holdBalanceMinor: 0,
        currency: input.currency ?? "INR",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
    };
}

export function freeze(account: Account, at: Date): Account {
    if (account.status === "Closed")
        throw new AccountInvalidStatusTransitionError(account.status, "Frozen");
    if (account.status === "Frozen") return account;
    return { ...account, status: "Frozen", updatedAt: at };
}

export function unfreeze(account: Account, at: Date): Account {
    if (account.status === "Closed")
        throw new AccountInvalidStatusTransitionError(account.status, "Active");
    if (account.status === "Active") return account;
    return { ...account, status: "Active", updatedAt: at };
}

/** Internal-only: zero an FD account principal at maturity / premature close. */
export function zeroFixedDepositPrincipal(account: Account, at: Date): Account {
    assertActive(account);
    if (account.accountType !== "fixed_deposit") throw new Error("Not a fixed deposit account");
    return { ...account, balanceMinor: 0, updatedAt: at };
}

export function close(account: Account, at: Date): Account {
    if (account.balanceMinor !== 0) throw new AccountCloseRequiresZeroBalanceError();
    if (account.holdBalanceMinor !== 0)
        throw new AccountCloseBlockedError("Account has active holds");
    if (account.status === "Closed") return account;
    return { ...account, status: "Closed", updatedAt: at };
}

export function placeHold(account: Account, amountMinor: number, at: Date): Account {
    assertActive(account);
    if (amountMinor <= 0 || !Number.isInteger(amountMinor)) throw new Error("Hold amount must be > 0");
    if (account.holdBalanceMinor + amountMinor > account.balanceMinor)
        throw new HoldExceedsBalanceError();
    return {
        ...account,
        holdBalanceMinor: account.holdBalanceMinor + amountMinor,
        updatedAt: at,
    };
}

export function releaseHold(account: Account, amountMinor: number, at: Date): Account {
    assertActive(account);
    if (amountMinor <= 0 || !Number.isInteger(amountMinor)) throw new Error("Hold amount must be > 0");
    if (account.holdBalanceMinor < amountMinor) throw new Error("Hold release exceeds active hold");
    return {
        ...account,
        holdBalanceMinor: account.holdBalanceMinor - amountMinor,
        updatedAt: at,
    };
}

/** Returns the new (updated) account after a debit. Throws if invalid. */
export function debit(account: Account, amountMinor: number, currency: Currency, at: Date): Account {
    assertActive(account);
    assertCurrency(account, currency);
    if (amountMinor <= 0) throw new Error("Amount must be > 0");
    if (account.accountType === "fixed_deposit") throw new FixedDepositWithdrawalBlockedError();
    if (availableBalanceMinor(account) < amountMinor) throw new InsufficientAvailableFundsError();
    const after = account.balanceMinor - amountMinor;
    const minBal = minBalanceForType(account.accountType);
    if (after < minBal) throw new MinimumBalanceViolationError(minBal);
    return { ...account, balanceMinor: after, updatedAt: at };
}

export function credit(account: Account, amountMinor: number, currency: Currency, at: Date): Account {
    assertActive(account);
    assertCurrency(account, currency);
    if (amountMinor <= 0) throw new Error("Amount must be > 0");
    return { ...account, balanceMinor: account.balanceMinor + amountMinor, updatedAt: at };
}

function assertActive(account: Account): void {
    if (account.status !== "Active") throw new AccountNotActiveError();
}
function assertCurrency(account: Account, currency: Currency): void {
    if (account.currency !== currency) throw new CurrencyMismatchError();
}
