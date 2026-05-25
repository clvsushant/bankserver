import type { Currency } from "../../../shared/money";
import {
    AccountInvalidStatusTransitionError,
    AccountCloseRequiresZeroBalanceError,
    InsufficientFundsError,
    CurrencyMismatchError,
    AccountNotActiveError,
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
}

export const ACCOUNT_TYPE_META: Record<AccountType, AccountTypeMeta> = {
    savings: {
        type: "savings",
        label: "Savings",
        description: "Everyday savings account with full transfer access.",
    },
    current: {
        type: "current",
        label: "Current",
        description: "For routine business activity, no minimum balance.",
    },
    fixed_deposit: {
        type: "fixed_deposit",
        label: "Fixed Deposit",
        description: "Lock-in deposit. Demo-only — withdrawals are still allowed.",
    },
};

export function isAccountType(v: unknown): v is AccountType {
    return typeof v === "string" && (ACCOUNT_TYPES as readonly string[]).includes(v);
}

export interface Account {
    readonly id: string;
    readonly accountNumber: string;
    readonly userId: string;
    readonly accountType: AccountType;
    status: AccountStatus;
    balanceMinor: number;
    currency: Currency;
    readonly createdAt: Date;
    updatedAt: Date;
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

export function close(account: Account, at: Date): Account {
    if (account.balanceMinor !== 0) throw new AccountCloseRequiresZeroBalanceError();
    if (account.status === "Closed") return account;
    return { ...account, status: "Closed", updatedAt: at };
}

/** Returns the new (updated) account after a debit. Throws if invalid. */
export function debit(account: Account, amountMinor: number, currency: Currency, at: Date): Account {
    assertActive(account);
    assertCurrency(account, currency);
    if (amountMinor <= 0) throw new Error("Amount must be > 0");
    if (account.balanceMinor < amountMinor) throw new InsufficientFundsError();
    return { ...account, balanceMinor: account.balanceMinor - amountMinor, updatedAt: at };
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
