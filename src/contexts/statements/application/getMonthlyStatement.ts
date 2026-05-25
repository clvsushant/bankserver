import type { Db } from "../../../db/client";
import { queryStatement, MonthlyStatement } from "../infrastructure/statementQuery";

export interface MonthlyStatementInput {
    accountId: string;
    month: string; // YYYY-MM
}

export function getMonthlyStatement(db: Db, input: MonthlyStatementInput): MonthlyStatement {
    const { accountId, month } = input;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month");
    const [year, m] = month.split("-").map(Number);

    const from = new Date(Date.UTC(year, m - 1, 1));
    const to = new Date(Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 1));

    return queryStatement(db, accountId, from, to);
}
