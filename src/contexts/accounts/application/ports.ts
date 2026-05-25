import type { Account } from "../domain/account";

export interface AccountRepo {
    findById(id: string): Account | undefined;
    findByAccountNumber(accountNumber: string): Account | undefined;
    listByUserId(userId: string): Account[];
    list(limit: number): Account[];
    insert(account: Account): void;
    update(account: Account): void;
}
