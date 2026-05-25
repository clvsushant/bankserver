import type { Beneficiary } from "../domain/beneficiary";

export interface BeneficiaryRepo {
    findById(id: string): Beneficiary | undefined;
    findByOwnerAndAccount(
        ownerUserId: string,
        accountNumber: string
    ): Beneficiary | undefined;
    listByOwner(ownerUserId: string): Beneficiary[];
    insert(b: Beneficiary): void;
    delete(id: string): void;
    /** Stamps `last_used_at` for analytics + sort order. */
    touch(id: string, at: Date): void;
}
