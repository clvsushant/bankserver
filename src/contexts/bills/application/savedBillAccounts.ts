import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import { BillerNotFoundError } from "../domain/errors";
import { createSavedBillAccount } from "../domain/savedBillAccount";
import type { BillerRepo } from "./ports";
import type { SavedBillAccountRepo } from "../infrastructure/savedBillAccountRepo";

export function listSavedBillAccounts(
    deps: { saved: SavedBillAccountRepo },
    userId: string
) {
    return deps.saved.listByUserId(userId);
}

export function saveBillAccount(
    deps: {
        saved: SavedBillAccountRepo;
        billers: BillerRepo;
        ids: IdGenerator;
        clock: Clock;
    },
    input: {
        userId: string;
        billerId: string;
        customerRef: string;
        nickname: string;
    }
) {
    const biller = deps.billers.findById(input.billerId);
    if (!biller || !biller.active) throw new BillerNotFoundError();
    const row = createSavedBillAccount({
        id: deps.ids.uuid(),
        userId: input.userId,
        billerId: input.billerId,
        customerRef: input.customerRef,
        nickname: input.nickname,
        createdAt: deps.clock.now(),
    });
    deps.saved.insert(row);
    return row;
}

export function removeSavedBillAccount(
    deps: { saved: SavedBillAccountRepo },
    input: { userId: string; id: string }
): void {
    const row = deps.saved.findById(input.id);
    if (!row || row.userId !== input.userId) throw new BillerNotFoundError();
    deps.saved.delete(input.id);
}
