import type { MonthlyStatement } from "../infrastructure/statementQuery";

/**
 * Renders a monthly statement as RFC 4180 CSV. Includes a small header
 * block for context (account, month, opening / closing balance, totals)
 * followed by one row per transaction.
 */
export function statementToCsv(args: {
    statement: MonthlyStatement;
    accountNumber: string;
}): string {
    const { statement, accountNumber } = args;
    const lines: string[] = [];

    const summaryRows: Array<[string, string]> = [
        ["Account number", accountNumber],
        ["Period", statement.month],
        ["Opening balance (paise)", String(statement.openingBalanceMinor)],
        ["Closing balance (paise)", String(statement.closingBalanceMinor)],
        ["Total credits (paise)", String(statement.totalCreditMinor)],
        ["Total debits (paise)", String(statement.totalDebitMinor)],
    ];
    for (const [k, v] of summaryRows) {
        lines.push(`${csv(k)},${csv(v)}`);
    }
    lines.push(""); // blank separator before the table

    lines.push(
        [
            "Posted At",
            "Reference",
            "Direction",
            "Counterparty",
            "Description",
            "Amount (paise)",
            "Running Balance (paise)",
            "Kind",
        ]
            .map(csv)
            .join(",")
    );

    for (const l of statement.lines) {
        lines.push(
            [
                l.postedAt,
                l.referenceNumber ?? l.transferId,
                l.direction,
                l.counterpartyName ?? "",
                l.description ?? l.memo ?? "",
                String(l.amountMinor),
                String(l.runningBalanceMinor),
                l.kind,
            ]
                .map(csv)
                .join(",")
        );
    }
    return lines.join("\r\n");
}

function csv(s: string | number): string {
    const v = String(s);
    if (/[",\r\n]/.test(v)) {
        return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
}
