import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import { makeAccountRepo } from "../../accounts/infrastructure/accountRepo";
import { makeTransferRepo } from "../infrastructure/transferRepo";
import { makeLedgerRepo } from "../infrastructure/ledgerRepo";
import { makeUserRepo } from "../../identity/infrastructure/userRepo";
import { credit, debit } from "../../accounts/domain/account";
import { createDispute, type Dispute } from "../domain/dispute";
import type { DisputeRepo, TransferRepo } from "./ports";
import type { Transfer } from "../domain/transfer";
import { generateUtr } from "../domain/transfer";
import type { MoneyMovedEvent } from "../domain/events";

export function fileDispute(
    deps: { disputes: DisputeRepo; transfers: TransferRepo; ids: IdGenerator; clock: Clock },
    input: { userId: string; transferId: string; reason: string }
): Dispute {
    const transfer = deps.transfers.findById(input.transferId);
    if (!transfer) throw new Error("Transfer not found");
    const dispute = createDispute({
        id: deps.ids.uuid(),
        userId: input.userId,
        transferId: input.transferId,
        reason: input.reason,
        createdAt: deps.clock.now(),
    });
    deps.disputes.insert(dispute);
    return dispute;
}

export function listDisputes(deps: { disputes: DisputeRepo }, userId: string): Dispute[] {
    return deps.disputes.listByUserId(userId);
}

export function decideDispute(
    deps: { db: Db; disputes: DisputeRepo; transfers: TransferRepo; clock: Clock; ids: IdGenerator; bus: EventBus },
    input: {
        disputeId: string;
        adminUserId: string;
        approve: boolean;
        adminNote?: string;
    }
): Dispute {
    const d = deps.disputes.findById(input.disputeId);
    if (!d) throw new Error("Dispute not found");
    if (d.status !== "submitted" && d.status !== "under_review")
        throw new Error("Dispute already decided");

    const now = deps.clock.now();
    if (!input.approve) {
        const rejected: Dispute = {
            ...d,
            status: "rejected",
            adminNote: input.adminNote,
            decidedAt: now,
            decidedByUserId: input.adminUserId,
        };
        deps.disputes.update(rejected);
        return rejected;
    }

    const events: MoneyMovedEvent[] = [];
    let reversalTransferId: string | undefined;

    deps.db.transaction((tx) => {
        const txDb = tx as unknown as Db;
        const transferRepo = makeTransferRepo(txDb);
        const accountRepo = makeAccountRepo(txDb);
        const ledgerRepo = makeLedgerRepo(txDb);
        const userRepo = makeUserRepo(txDb);

        const original = transferRepo.findById(d.transferId);
        if (!original?.fromAccountId || !original.toAccountId)
            throw new Error("Cannot reverse transfer without both accounts");

        const from = accountRepo.findById(original.toAccountId);
        const to = accountRepo.findById(original.fromAccountId);
        if (!from || !to) throw new Error("Accounts missing for reversal");

        const debited = debit(from, original.amountMinor, original.currency, now);
        const credited = credit(to, original.amountMinor, original.currency, now);
        const fromUser = userRepo.findById(from.userId);
        const toUser = userRepo.findById(to.userId);

        const reversal: Transfer = {
            id: deps.ids.uuid(),
            fromAccountId: debited.id,
            toAccountId: credited.id,
            amountMinor: original.amountMinor,
            currency: original.currency,
            memo: `Reversal for ${original.referenceNumber ?? original.id}`,
            kind: "reversal",
            status: "posted",
            rail: "internal",
            utr: generateUtr(now),
            postedAt: now,
            referenceNumber: deps.ids.transactionReference(),
            feeMinor: 0,
            category: original.category,
            fromAccountNumber: from.accountNumber,
            toAccountNumber: to.accountNumber,
            fromUsername: fromUser?.username,
            toUsername: toUser?.username,
            description: `Dispute reversal for transfer ${original.id}`,
        };

        transferRepo.insert(reversal);
        accountRepo.update(debited);
        accountRepo.update(credited);
        ledgerRepo.insert({
            id: deps.ids.uuid(),
            accountId: debited.id,
            transferId: reversal.id,
            kind: "debit",
            amountMinor: original.amountMinor,
            runningBalanceMinor: debited.balanceMinor,
            postedAt: now,
        });
        ledgerRepo.insert({
            id: deps.ids.uuid(),
            accountId: credited.id,
            transferId: reversal.id,
            kind: "credit",
            amountMinor: original.amountMinor,
            runningBalanceMinor: credited.balanceMinor,
            postedAt: now,
        });

        reversalTransferId = reversal.id;
        events.push({
            type: "MoneyMoved",
            transferId: reversal.id,
            fromAccountId: debited.id,
            toAccountId: credited.id,
            amountMinor: original.amountMinor,
            currency: original.currency,
            kind: "reversal",
            postedAt: now,
        });
    });

    const approved: Dispute = {
        ...d,
        status: "approved",
        adminNote: input.adminNote,
        reversalTransferId,
        decidedAt: now,
        decidedByUserId: input.adminUserId,
    };
    deps.disputes.update(approved);
    if (events.length > 0) deps.bus.publish(events);
    return approved;
}
