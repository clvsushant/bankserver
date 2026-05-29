import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import { makeAccountRepo } from "../infrastructure/accountRepo";
import { makeFixedDepositRepo } from "../infrastructure/fixedDepositRepo";
import { credit, debit, open } from "../domain/account";
import { openFixedDeposit as openFdDomain } from "../domain/fixedDeposit";
import { AccountNotFoundError } from "../domain/errors";
import type { FixedDeposit } from "../domain/fixedDeposit";
import type { AccountRepo, FixedDepositRepo } from "./ports";

export function openFixedDeposit(
    deps: {
        db: Db;
        accounts: AccountRepo;
        fixedDeposits: FixedDepositRepo;
        ids: IdGenerator;
        clock: Clock;
        bus?: EventBus;
    },
    input: {
        userId: string;
        payoutAccountId: string;
        principalMinor: number;
        tenureMonths: number;
        autoRenew?: boolean;
    }
): FixedDeposit {
    return deps.db.transaction((tx) => {
        const txDb = tx as unknown as Db;
        const accountRepo = makeAccountRepo(txDb);
        const fdRepo = makeFixedDepositRepo(txDb);
        const now = deps.clock.now();

        const payout = accountRepo.findById(input.payoutAccountId);
        if (!payout || payout.userId !== input.userId) throw new AccountNotFoundError();

        const debited = debit(payout, input.principalMinor, "INR", now);

        let accountNumber = deps.ids.accountNumber();
        while (accountRepo.findByAccountNumber(accountNumber)) {
            accountNumber = deps.ids.accountNumber();
        }

        const fdAccount = open({
            id: deps.ids.uuid(),
            accountNumber,
            userId: input.userId,
            accountType: "fixed_deposit",
            createdAt: now,
        });
        const fdAccountFunded = credit(fdAccount, input.principalMinor, "INR", now);

        const fd = openFdDomain({
            id: deps.ids.uuid(),
            accountId: fdAccountFunded.id,
            userId: input.userId,
            payoutAccountId: payout.id,
            principalMinor: input.principalMinor,
            tenureMonths: input.tenureMonths,
            autoRenew: input.autoRenew ?? false,
            openedAt: now,
        });

        accountRepo.update(debited);
        accountRepo.insert(fdAccountFunded);
        fdRepo.insert(fd);

        return fd;
    });
}
