import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import { makeAccountRepo } from "../infrastructure/accountRepo";
import { makeFixedDepositRepo } from "../infrastructure/fixedDepositRepo";
import { close, credit, zeroFixedDepositPrincipal } from "../domain/account";
import { markPrematureClosed, prematureInterestMinor } from "../domain/fixedDeposit";
import { AccountNotFoundError } from "../domain/errors";
import type { FixedDeposit } from "../domain/fixedDeposit";
import type { FixedDepositRepo } from "./ports";

export function prematureCloseFixedDeposit(
    deps: { db: Db; fixedDeposits: FixedDepositRepo; clock: Clock; ids: IdGenerator },
    input: { userId: string; fixedDepositId: string }
): FixedDeposit {
    return deps.db.transaction((tx) => {
        const txDb = tx as unknown as Db;
        const accountRepo = makeAccountRepo(txDb);
        const fdRepo = makeFixedDepositRepo(txDb);
        const now = deps.clock.now();

        const fd = fdRepo.findById(input.fixedDepositId);
        if (!fd || fd.userId !== input.userId) throw new AccountNotFoundError();
        if (fd.status !== "active") throw new Error("Fixed deposit is not active");

        const fdAccount = accountRepo.findById(fd.accountId);
        const payout = accountRepo.findById(fd.payoutAccountId);
        if (!fdAccount || !payout) throw new AccountNotFoundError();

        const interest = prematureInterestMinor(fd, now);
        const totalPayout = fd.principalMinor + interest;

        const emptied = zeroFixedDepositPrincipal(fdAccount, now);
        const closedFd = close(emptied, now);
        const credited = credit(payout, totalPayout, "INR", now);
        const updated = markPrematureClosed(fd, interest, now);

        accountRepo.update(closedFd);
        accountRepo.update(credited);
        fdRepo.update(updated);

        return updated;
    });
}
