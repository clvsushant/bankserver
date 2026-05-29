import type { Account } from "../domain/account";
import type { FixedDeposit } from "../domain/fixedDeposit";
import type { Nominee } from "../domain/nominee";

export interface AccountRepo {
    findById(id: string): Account | undefined;
    findByAccountNumber(accountNumber: string): Account | undefined;
    listByUserId(userId: string): Account[];
    list(limit: number): Account[];
    insert(account: Account): void;
    update(account: Account): void;
}

export interface FixedDepositRepo {
    findById(id: string): FixedDeposit | undefined;
    findByAccountId(accountId: string): FixedDeposit | undefined;
    listActiveByUserId(userId: string): FixedDeposit[];
    listByUserId(userId: string): FixedDeposit[];
    listDueForMaturity(now: Date): FixedDeposit[];
    insert(fd: FixedDeposit): void;
    update(fd: FixedDeposit): void;
}

export interface NomineeRepo {
    findById(id: string): Nominee | undefined;
    listByAccountId(accountId: string): Nominee[];
    insert(n: Nominee): void;
    delete(id: string): void;
}
