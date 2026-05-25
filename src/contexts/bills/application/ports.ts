import type { Biller, BillerCategory } from "../domain/biller";

export interface BillerRepo {
    findById(id: string): Biller | undefined;
    findByAccountNumber(accountNumber: string): Biller | undefined;
    listActive(): Biller[];
    listAll(): Biller[];
    insert(b: Biller): void;
    setActive(id: string, active: boolean): void;
}

export interface BillerSeed {
    name: string;
    category: BillerCategory;
}
