import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import { createNominee } from "../domain/nominee";
import { AccountNotFoundError } from "../domain/errors";
import type { AccountRepo, NomineeRepo } from "./ports";
import type { Nominee } from "../domain/nominee";

export function addNominee(
    deps: { accounts: AccountRepo; nominees: NomineeRepo; ids: IdGenerator; clock: Clock },
    input: {
        userId: string;
        accountId: string;
        fullName: string;
        relation: string;
        sharePercent?: number;
    }
): Nominee {
    const account = deps.accounts.findById(input.accountId);
    if (!account || account.userId !== input.userId) throw new AccountNotFoundError();

    const nominee = createNominee({
        id: deps.ids.uuid(),
        accountId: account.id,
        userId: input.userId,
        fullName: input.fullName,
        relation: input.relation,
        sharePercent: input.sharePercent,
        createdAt: deps.clock.now(),
    });
    deps.nominees.insert(nominee);
    return nominee;
}

export function listNominees(
    deps: { accounts: AccountRepo; nominees: NomineeRepo },
    input: { userId: string; accountId: string }
): Nominee[] {
    const account = deps.accounts.findById(input.accountId);
    if (!account || account.userId !== input.userId) throw new AccountNotFoundError();
    return deps.nominees.listByAccountId(account.id);
}

export function removeNominee(
    deps: { accounts: AccountRepo; nominees: NomineeRepo },
    input: { userId: string; nomineeId: string }
): void {
    const nominee = deps.nominees.findById(input.nomineeId);
    if (!nominee || nominee.userId !== input.userId) throw new AccountNotFoundError();
    deps.nominees.delete(nominee.id);
}
