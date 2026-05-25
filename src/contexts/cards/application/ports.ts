import type { DebitCard } from "../domain/card";

export interface DebitCardRepo {
    findById(id: string): DebitCard | undefined;
    listByAccount(accountId: string): DebitCard[];
    insert(card: DebitCard): void;
    update(card: DebitCard): void;
}
