import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import { makeAccountRepo } from "../infrastructure/accountRepo";
import { makeFixedDepositRepo } from "../infrastructure/fixedDepositRepo";
import { close, credit, zeroFixedDepositPrincipal } from "../domain/account";
import { markMatured, maturityInterestMinor } from "../domain/fixedDeposit";
import type { FixedDepositRepo } from "./ports";

export interface MatureFdResult {
    readonly matured: number;
    readonly failed: number;
}

export function matureFixedDeposits(
    deps: { db: Db; fixedDeposits: FixedDepositRepo; clock: Clock; ids: IdGenerator },
    _now?: Date
): MatureFdResult {
    const now = _now ?? deps.clock.now();
    const due = deps.fixedDeposits.listDueForMaturity(now);
    let matured = 0;
    let failed = 0;

    for (const fd of due) {
        try {
            deps.db.transaction((tx) => {
                const txDb = tx as unknown as Db;
                const accountRepo = makeAccountRepo(txDb);
                const fdRepo = makeFixedDepositRepo(txDb);

                const current = fdRepo.findById(fd.id);
                if (!current || current.status !== "active") return;

                const fdAccount = accountRepo.findById(current.accountId);
                const payout = accountRepo.findById(current.payoutAccountId);
                if (!fdAccount || !payout) throw new Error("FD accounts missing");

                const interest = maturityInterestMinor(current);
                const totalPayout = current.principalMinor + interest;

                const emptied = zeroFixedDepositPrincipal(fdAccount, now);
                const closedFd = close(emptied, now);
                const credited = credit(payout, totalPayout, "INR", now);
                const updatedFd = markMatured(
                    { ...current, interestPaidMinor: interest },
                    now
                );

                accountRepo.update(closedFd);
                accountRepo.update(credited);
                fdRepo.update(updatedFd);
            });
            matured += 1;
        } catch {
            failed += 1;
        }
    }

    return { matured, failed };
}
