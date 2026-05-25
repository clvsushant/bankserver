import type { Db } from "../../../db/client";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import { advanceRun } from "../domain/standingInstruction";
import type { StandingInstructionRepo } from "./ports";
import type { BeneficiaryRepo } from "../../beneficiaries/application/ports";
import { executeTransfer } from "../../payments/application/executeTransfer";

export interface RunResult {
    totalDue: number;
    succeeded: number;
    failed: number;
    failures: Array<{ siId: string; error: string }>;
}

/**
 * Drives all due standing instructions through `executeTransfer`. One row
 * = one transfer; idempotency key includes the planned run timestamp so a
 * repeat tick will not double-post.
 *
 * Errors on individual instructions (e.g. insufficient funds) do NOT halt
 * the loop — the SI keeps its status (so it'll retry on the next tick or
 * the user can intervene). For demo simplicity we don't auto-pause on
 * persistent failure; the receipt for failed runs is captured in the
 * failures array.
 */
export function runDueInstructions(
    deps: {
        db: Db;
        clock: Clock;
        ids: IdGenerator;
        bus: EventBus;
        siRepo: StandingInstructionRepo;
        beneficiaries: BeneficiaryRepo;
    }
): RunResult {
    const now = deps.clock.now();
    const due = deps.siRepo.listDue(now);

    const result: RunResult = { totalDue: due.length, succeeded: 0, failed: 0, failures: [] };

    for (const si of due) {
        const beneficiary = deps.beneficiaries.findById(si.beneficiaryId);
        if (!beneficiary) {
            result.failed += 1;
            result.failures.push({ siId: si.id, error: "Beneficiary missing" });
            continue;
        }
        try {
            executeTransfer(
                {
                    db: deps.db,
                    clock: deps.clock,
                    ids: deps.ids,
                    bus: deps.bus,
                },
                {
                    fromAccountId: si.fromAccountId,
                    toAccountNumber: beneficiary.accountNumber,
                    amountMinor: si.amountMinor,
                    currency: si.currency,
                    memo: si.description ?? `Standing instruction ${si.id.slice(0, 8)}`,
                    idempotencyKey: `si:${si.id}:${si.nextRunAt.getTime()}`,
                }
            );
            const nextRun = advanceRun(si.nextRunAt, si.frequency);
            deps.siRepo.update({
                ...si,
                nextRunAt: nextRun,
                lastRunAt: now,
                status: "active",
            });
            // Publish a custom event so the notifications subscriber can fire.
            deps.bus.publish([
                {
                    type: "StandingInstructionRan",
                    siId: si.id,
                    ownerUserId: si.ownerUserId,
                    amountMinor: si.amountMinor,
                    beneficiaryAccountNumber: beneficiary.accountNumber,
                    ranAt: now,
                } as unknown as { type: string },
            ]);
            result.succeeded += 1;
        } catch (e) {
            result.failed += 1;
            result.failures.push({
                siId: si.id,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    return result;
}
