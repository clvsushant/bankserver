import type { MonthlyStatement } from "../infrastructure/statementQuery";

/**
 * Renders a minimal valid PDF (text-only, no external deps) for monthly statements.
 * Suitable for demo / download; not a full typographic layout.
 */
export function statementToPdfBase64(args: {
    statement: MonthlyStatement;
    accountNumber: string;
}): string {
    const { statement, accountNumber } = args;
    const lines: string[] = [
        "Sentinel Bank — Account Statement",
        `Account: ${accountNumber}`,
        `Period: ${statement.month}`,
        `Opening balance (paise): ${statement.openingBalanceMinor}`,
        `Closing balance (paise): ${statement.closingBalanceMinor}`,
        `Total credits (paise): ${statement.totalCreditMinor}`,
        `Total debits (paise): ${statement.totalDebitMinor}`,
        "",
        "Transactions:",
    ];
    for (const l of statement.lines) {
        lines.push(
            `${l.postedAt.slice(0, 10)} ${l.direction} ${l.amountMinor} paise — ${l.description ?? l.memo ?? l.referenceNumber ?? l.transferId}`
        );
    }
    const body = lines.map((line) => pdfEscape(line)).join("\\n");
    const stream = `BT /F1 10 Tf 50 750 Td (${body}) Tj ET`;
    const pdf = [
        "%PDF-1.4",
        "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
        "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
        "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj",
        `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream endobj`,
        "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj",
        "xref",
        "0 6",
        "0000000000 65535 f ",
        "0000000009 00000 n ",
        "0000000058 00000 n ",
        "0000000115 00000 n ",
        "0000000266 00000 n ",
        "0000000350 00000 n ",
        "trailer<< /Size 6 /Root 1 0 R >>",
        "startxref",
        "420",
        "%%EOF",
    ].join("\n");
    return Buffer.from(pdf, "utf8").toString("base64");
}

function pdfEscape(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
