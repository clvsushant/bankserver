import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { adminPendingActions } from "../db/schema";
import type { Clock } from "../shared/clock";
import type { IdGenerator } from "../shared/ids";

/** Faucet amounts above ₹10,000 require maker-checker approval. */
export const FAUCET_MAKER_CHECKER_THRESHOLD_MINOR = 1_000_000;

export type PendingActionStatus = "pending" | "approved" | "rejected" | "executed";

export interface AdminPendingAction {
    readonly id: string;
    readonly action: string;
    readonly requestedByUserId: string;
    approvedByUserId?: string;
    readonly payload: string;
    status: PendingActionStatus;
    readonly createdAt: Date;
    decidedAt?: Date;
}

export function requiresMakerChecker(amountMinor: number): boolean {
    return amountMinor > FAUCET_MAKER_CHECKER_THRESHOLD_MINOR;
}

export function createPendingAction(
    db: Db,
    deps: { ids: IdGenerator; clock: Clock },
    input: { action: string; requestedByUserId: string; payload: object }
): AdminPendingAction {
    const row: AdminPendingAction = {
        id: deps.ids.uuid(),
        action: input.action,
        requestedByUserId: input.requestedByUserId,
        payload: JSON.stringify(input.payload),
        status: "pending",
        createdAt: deps.clock.now(),
    };
    db.insert(adminPendingActions)
        .values({
            id: row.id,
            action: row.action,
            requestedByUserId: row.requestedByUserId,
            approvedByUserId: null,
            payload: row.payload,
            status: row.status,
            createdAt: row.createdAt,
            decidedAt: null,
        })
        .run();
    return row;
}

export function listPendingActions(db: Db): AdminPendingAction[] {
    const rows = db
        .select()
        .from(adminPendingActions)
        .where(eq(adminPendingActions.status, "pending"))
        .all();
    return rows.map((r) => ({
        id: r.id,
        action: r.action,
        requestedByUserId: r.requestedByUserId,
        approvedByUserId: r.approvedByUserId ?? undefined,
        payload: r.payload,
        status: r.status as PendingActionStatus,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt ?? undefined,
    }));
}

export function approvePendingAction(
    db: Db,
    deps: { clock: Clock },
    input: { id: string; approvedByUserId: string }
): AdminPendingAction | undefined {
    const [row] = db
        .select()
        .from(adminPendingActions)
        .where(eq(adminPendingActions.id, input.id))
        .limit(1)
        .all();
    if (!row || row.status !== "pending") return undefined;
    const now = deps.clock.now();
    db.update(adminPendingActions)
        .set({
            status: "approved",
            approvedByUserId: input.approvedByUserId,
            decidedAt: now,
        })
        .where(eq(adminPendingActions.id, input.id))
        .run();
    return {
        id: row.id,
        action: row.action,
        requestedByUserId: row.requestedByUserId,
        approvedByUserId: input.approvedByUserId,
        payload: row.payload,
        status: "approved",
        createdAt: row.createdAt,
        decidedAt: now,
    };
}

export function markPendingExecuted(db: Db, id: string): void {
    db.update(adminPendingActions)
        .set({ status: "executed" })
        .where(eq(adminPendingActions.id, id))
        .run();
}
