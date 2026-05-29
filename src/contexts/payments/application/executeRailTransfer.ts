import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import type { Currency } from "../../../shared/money";
import { makeAccountRepo } from "../../accounts/infrastructure/accountRepo";
import { makeTransferRepo } from "../infrastructure/transferRepo";
import { makeLedgerRepo } from "../infrastructure/ledgerRepo";
import { makeUserRepo } from "../../identity/infrastructure/userRepo";
import { credit, debit, placeHold } from "../../accounts/domain/account";
import { AccountNotFoundError } from "../../accounts/domain/errors";
import { TransferAmountInvalidError, TransferAggregateLimitError } from "../domain/errors";
import type { Transfer, TransferRail } from "../domain/transfer";
import { generateUtr } from "../domain/transfer";
import type { MoneyMovedEvent } from "../domain/events";
import { executeTransfer } from "./executeTransfer";
import type { KycTier } from "../../../services/transferLimits";
import { makeKycRepo } from "../../kyc/infrastructure/kycRepo";
import { assertBankingAccess } from "../../kyc/application/bankingAccess";

export interface ExecuteRailTransferInput {
    fromAccountId: string;
    toAccountNumber: string;
    amountMinor: number;
    currency: Currency;
    rail: "imps" | "neft" | "rtgs" | "upi";
    memo?: string;
    idempotencyKey?: string;
    ownerUserId: string;
    kycTier: KycTier;
    /** UPI stub — validated VPA format only in demo. */
    vpa?: string;
}

export function executeRailTransfer(
    deps: { db: Db; clock: Clock; ids: IdGenerator; bus: EventBus },
    input: ExecuteRailTransferInput
): Transfer {
    if (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor))
        throw new TransferAmountInvalidError();

    assertBankingAccess(
        {
            kyc: makeKycRepo(deps.db),
            accounts: makeAccountRepo(deps.db),
        },
        input.ownerUserId
    );
    if (input.kycTier === "none") {
        throw new TransferAggregateLimitError("KYC verification required before transfers");
    }

    if (input.rail === "upi") {
        const vpa = input.vpa?.trim();
        if (!vpa || !/^[\w.-]+@[\w.-]+$/.test(vpa))
            throw new Error("Invalid UPI VPA");
    }

    // IMPS and internal-style instant settlement.
    if (input.rail === "imps") {
        const t = executeTransfer(deps, {
            fromAccountId: input.fromAccountId,
            toAccountNumber: input.toAccountNumber,
            amountMinor: input.amountMinor,
            currency: input.currency,
            memo: input.memo,
            idempotencyKey: input.idempotencyKey,
            ownerUserId: input.ownerUserId,
            kycTier: input.kycTier,
            rail: "imps",
        });
        const utr = generateUtr(deps.clock.now());
        const updated: Transfer = { ...t, utr };
        deps.db.transaction((tx) => {
            makeTransferRepo(tx as unknown as Db).update(updated);
        });
        return { ...updated, utr };
    }

    // NEFT / RTGS: place hold, create pending transfer (no ledger until settle).
    if (input.rail === "neft" || input.rail === "rtgs") {
        return createPendingRailTransfer(deps, input);
    }

    // UPI stub: instant posted with generated UTR.
    const t = executeTransfer(deps, {
        fromAccountId: input.fromAccountId,
        toAccountNumber: input.toAccountNumber,
        amountMinor: input.amountMinor,
        currency: input.currency,
        memo: input.memo ?? `UPI ${input.vpa}`,
        idempotencyKey: input.idempotencyKey,
        ownerUserId: input.ownerUserId,
        kycTier: input.kycTier,
        rail: "upi",
    });
    const utr = generateUtr(deps.clock.now());
    const updated: Transfer = { ...t, utr, description: `UPI to ${input.vpa}` };
    deps.db.transaction((tx) => {
        makeTransferRepo(tx as unknown as Db).update(updated);
    });
    return updated;
}

function createPendingRailTransfer(
    deps: { db: Db; clock: Clock; ids: IdGenerator; bus: EventBus },
    input: ExecuteRailTransferInput
): Transfer {
    const events: MoneyMovedEvent[] = [];

    const transfer = deps.db.transaction((tx): Transfer => {
        const txDb = tx as unknown as Db;
        const accountRepo = makeAccountRepo(txDb);
        const transferRepo = makeTransferRepo(txDb);
        const userRepo = makeUserRepo(txDb);

        if (input.idempotencyKey) {
            const prior = transferRepo.findByIdempotencyKey(input.idempotencyKey);
            if (prior) return prior;
        }

        const from = accountRepo.findById(input.fromAccountId);
        if (!from) throw new AccountNotFoundError();
        const to = accountRepo.findByAccountNumber(input.toAccountNumber);
        if (!to) throw new AccountNotFoundError();

        const now = deps.clock.now();
        const held = placeHold(from, input.amountMinor, now);
        const fromUser = userRepo.findById(from.userId);
        const toUser = userRepo.findById(to.userId);

        const newTransfer: Transfer = {
            id: deps.ids.uuid(),
            idempotencyKey: input.idempotencyKey,
            fromAccountId: from.id,
            toAccountId: to.id,
            amountMinor: input.amountMinor,
            currency: input.currency,
            memo: input.memo,
            kind: "transfer",
            status: "pending",
            rail: input.rail,
            utr: generateUtr(now),
            postedAt: now,
            referenceNumber: deps.ids.transactionReference(),
            feeMinor: 0,
            category: from.userId === to.userId ? "self" : "p2p",
            fromAccountNumber: from.accountNumber,
            toAccountNumber: to.accountNumber,
            fromUsername: fromUser?.username,
            toUsername: toUser?.username,
            description: `${input.rail.toUpperCase()} transfer pending settlement`,
        };

        transferRepo.insert(newTransfer);
        accountRepo.update(held);
        return newTransfer;
    });

    if (events.length > 0) deps.bus.publish(events);
    return transfer;
}
