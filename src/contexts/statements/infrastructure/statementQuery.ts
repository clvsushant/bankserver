import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { ledgerEntries, transfers } from "../../../db/schema";

export interface StatementLine {
    postedAt: string; // ISO
    transferId: string;
    direction: "debit" | "credit";
    amountMinor: number;
    runningBalanceMinor: number;
    counterpartyAccountId?: string;
    counterpartyName?: string;
    referenceNumber?: string;
    memo?: string;
    description?: string;
    kind: "transfer" | "faucet";
}

export interface MonthlyStatement {
    accountId: string;
    month: string; // YYYY-MM
    openingBalanceMinor: number;
    closingBalanceMinor: number;
    totalDebitMinor: number;
    totalCreditMinor: number;
    lines: StatementLine[];
}

/**
 * Inclusive of `from`, exclusive of `to`. Returns one row per ledger entry
 * with the matching transfer for context.
 */
export function queryStatement(
    db: Db,
    accountId: string,
    from: Date,
    to: Date
): MonthlyStatement {
    const rows = db
        .select({
            ledger: ledgerEntries,
            transfer: transfers,
        })
        .from(ledgerEntries)
        .innerJoin(transfers, eq(transfers.id, ledgerEntries.transferId))
        .where(
            and(
                eq(ledgerEntries.accountId, accountId),
                gte(ledgerEntries.postedAt, from),
                lt(ledgerEntries.postedAt, to)
            )
        )
        .orderBy(asc(ledgerEntries.postedAt))
        .all();

    const lines: StatementLine[] = rows.map((r) => {
        const counterparty =
            r.ledger.kind === "debit" ? r.transfer.toAccountId : r.transfer.fromAccountId;
        const counterpartyName =
            r.ledger.kind === "debit"
                ? (r.transfer.toUsername ?? r.transfer.toAccountNumber ?? undefined)
                : (r.transfer.fromUsername ?? r.transfer.fromAccountNumber ?? undefined);
        return {
            postedAt: r.ledger.postedAt.toISOString(),
            transferId: r.transfer.id,
            direction: r.ledger.kind as "debit" | "credit",
            amountMinor: r.ledger.amountMinor,
            runningBalanceMinor: r.ledger.runningBalanceMinor,
            counterpartyAccountId: counterparty ?? undefined,
            counterpartyName,
            referenceNumber: r.transfer.referenceNumber ?? undefined,
            memo: r.transfer.memo ?? undefined,
            description: r.transfer.description ?? undefined,
            kind: r.transfer.kind as "transfer" | "faucet",
        };
    });

    const totalDebitMinor = lines
        .filter((l) => l.direction === "debit")
        .reduce((s, l) => s + l.amountMinor, 0);
    const totalCreditMinor = lines
        .filter((l) => l.direction === "credit")
        .reduce((s, l) => s + l.amountMinor, 0);
    const closingBalanceMinor =
        lines.length > 0 ? lines[lines.length - 1].runningBalanceMinor : 0;
    const openingBalanceMinor =
        lines.length > 0
            ? lines[0].direction === "credit"
                ? lines[0].runningBalanceMinor - lines[0].amountMinor
                : lines[0].runningBalanceMinor + lines[0].amountMinor
            : closingBalanceMinor;

    const month = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`;

    return {
        accountId,
        month,
        openingBalanceMinor,
        closingBalanceMinor,
        totalDebitMinor,
        totalCreditMinor,
        lines,
    };
}
