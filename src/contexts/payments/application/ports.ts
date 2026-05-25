import type { Transfer, LedgerEntry } from "../domain/transfer";

export interface TransferRepo {
    findById(id: string): Transfer | undefined;
    findByIdempotencyKey(key: string): Transfer | undefined;
    insert(t: Transfer): void;
    list(limit: number): Transfer[];
}

export interface LedgerRepo {
    insert(e: LedgerEntry): void;
    listByAccountIdInRange(
        accountId: string,
        fromMs: number,
        toMs: number
    ): LedgerEntry[];
    listByAccountId(accountId: string, limit: number): LedgerEntry[];
    listByTransferId(transferId: string): LedgerEntry[];
}
