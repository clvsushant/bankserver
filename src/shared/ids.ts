import crypto from "crypto";

/**
 * Port the application layer depends on so domain/use-cases never call
 * `crypto.randomUUID` directly. Tests substitute a deterministic generator.
 */
export interface IdGenerator {
    uuid(): string;
    accountNumber(): string;
    /**
     * Human-readable transaction reference (`TXN-XXXX-XXXX`). Distinct from
     * the internal UUID; rendered to the user on receipts.
     */
    transactionReference(): string;
}

export const systemIds: IdGenerator = {
    uuid: () => crypto.randomUUID(),
    accountNumber: () => {
        // 10-digit numeric, prefixed for human friendliness. Real banks use
        // ISO 13616 IBAN or NPCI account numbering. For a demo a 10-digit
        // numeric tail is plenty.
        const n = crypto.randomInt(0, 1e10);
        return `SBE-${n.toString().padStart(10, "0")}`;
    },
    transactionReference: () => {
        // 8 hex chars from a CSPRNG, split for readability. Length ≈ 32 bits
        // — plenty for a demo, and still safe under uniqueness retries.
        const buf = crypto.randomBytes(4).toString("hex").toUpperCase();
        return `TXN-${buf.slice(0, 4)}-${buf.slice(4)}`;
    },
};
