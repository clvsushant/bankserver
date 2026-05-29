import type { Transfer, LedgerEntry, TransferRail, TransferStatus } from "../domain/transfer";
import type { Dispute } from "../domain/dispute";

export interface TransferRepo {
    findById(id: string): Transfer | undefined;
    findByIdempotencyKey(key: string): Transfer | undefined;
    insert(t: Transfer): void;
    update(t: Transfer): void;
    list(limit: number): Transfer[];
    listPendingByRail(rail: TransferRail): Transfer[];
    settlePending(
        id: string,
        patch: {
            status: TransferStatus;
            utr?: string;
            postedAt: Date;
            failureReason?: string;
        }
    ): void;
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

export interface DisputeRepo {
    findById(id: string): Dispute | undefined;
    listByUserId(userId: string): Dispute[];
    listAll(limit: number): Dispute[];
    insert(d: Dispute): void;
    update(d: Dispute): void;
}
