import type { Beneficiary } from "../domain/beneficiary";
import type { ExternalBeneficiary } from "../domain/externalBeneficiary";

export interface BeneficiaryRepo {
    findById(id: string): Beneficiary | undefined;
    findByOwnerAndAccount(
        ownerUserId: string,
        accountNumber: string
    ): Beneficiary | undefined;
    listByOwner(ownerUserId: string): Beneficiary[];
    insert(b: Beneficiary): void;
    update(b: Beneficiary): void;
    delete(id: string): void;
    /** Stamps `last_used_at` for analytics + sort order. */
    touch(id: string, at: Date): void;
    /** Batch-activate beneficiaries whose cooling period has elapsed. */
    activateDueBeneficiaries(now: Date): number;
}

export interface ExternalBeneficiaryRepo {
    findById(id: string): ExternalBeneficiary | undefined;
    findByOwnerAccountIfsc(
        ownerUserId: string,
        accountNumber: string,
        ifsc: string
    ): ExternalBeneficiary | undefined;
    listByOwner(ownerUserId: string): ExternalBeneficiary[];
    insert(b: ExternalBeneficiary): void;
}
