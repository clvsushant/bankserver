import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv, grantBankingAccess } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";
import { addBeneficiary } from "../contexts/beneficiaries/application/manageBeneficiary";
import {
    cancelStandingInstruction,
    createStandingInstruction,
    pauseStandingInstruction,
    resumeStandingInstruction,
} from "../contexts/standingInstructions/application/manageInstructions";
import { runDueInstructions } from "../contexts/standingInstructions/application/runDueInstructions";
import {
    StandingInstructionInvalidStateError,
    StandingInstructionNotFoundError,
} from "../contexts/standingInstructions/domain/errors";
import { advanceRun } from "../contexts/standingInstructions/domain/standingInstruction";

function setup() {
    const env = makeTestEnv();
    const owner = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const target = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "bob"
    );
    const fromAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        owner.id
    );
    const toAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        target.id
    );
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: fromAcc.id, amountMinor: 1_000_000, currency: "INR" }
    );
    const beneficiary = addBeneficiary(
        {
            repo: env.repos.beneficiaries,
            accounts: env.repos.accounts,
            users: env.repos.users,
            ids: env.ids,
            clock: env.clock,
        },
        { ownerUserId: owner.id, nickname: "Bobby", accountNumber: toAcc.accountNumber }
    );
    return { env, owner, target, fromAcc, toAcc, beneficiary };
}

function siDeps(env: ReturnType<typeof makeTestEnv>) {
    return {
        repo: env.repos.standingInstructions,
        accounts: env.repos.accounts,
        beneficiaries: env.repos.beneficiaries,
        kyc: env.repos.kyc,
        ids: env.ids,
        clock: env.clock,
    };
}

test("createStandingInstruction schedules nextRunAt one tick ahead", () => {
    const { env, owner, fromAcc, beneficiary } = setup();
    grantBankingAccess(env, owner.id);
    const si = createStandingInstruction(
        siDeps(env),
        {
            ownerUserId: owner.id,
            fromAccountId: fromAcc.id,
            beneficiaryId: beneficiary.id,
            amountMinor: 1000,
            currency: "INR",
            frequency: "monthly",
        }
    );
    assert.equal(si.status, "active");
    assert.deepEqual(si.nextRunAt, advanceRun(env.clock.now(), "monthly"));
});

test("pause / resume / cancel transitions and idempotency", () => {
    const { env, owner, fromAcc, beneficiary } = setup();
    grantBankingAccess(env, owner.id);
    const si = createStandingInstruction(
        siDeps(env),
        {
            ownerUserId: owner.id,
            fromAccountId: fromAcc.id,
            beneficiaryId: beneficiary.id,
            amountMinor: 1000,
            currency: "INR",
            frequency: "weekly",
        }
    );
    pauseStandingInstruction(
        { repo: env.repos.standingInstructions },
        { ownerUserId: owner.id, id: si.id }
    );
    assert.equal(env.repos.standingInstructions.findById(si.id)!.status, "paused");
    assert.throws(
        () =>
            pauseStandingInstruction(
                { repo: env.repos.standingInstructions },
                { ownerUserId: owner.id, id: si.id }
            ),
        StandingInstructionInvalidStateError
    );
    resumeStandingInstruction(
        { repo: env.repos.standingInstructions },
        { ownerUserId: owner.id, id: si.id }
    );
    assert.equal(env.repos.standingInstructions.findById(si.id)!.status, "active");
    cancelStandingInstruction(
        { repo: env.repos.standingInstructions },
        { ownerUserId: owner.id, id: si.id }
    );
    assert.equal(env.repos.standingInstructions.findById(si.id)!.status, "cancelled");
    assert.throws(
        () =>
            cancelStandingInstruction(
                { repo: env.repos.standingInstructions },
                { ownerUserId: "other", id: si.id }
            ),
        StandingInstructionNotFoundError
    );
});

test("runDueInstructions posts a transfer and advances nextRunAt; idempotent on tick repeat", () => {
    const { env, owner, fromAcc, beneficiary, toAcc } = setup();
    grantBankingAccess(env, owner.id);
    const si = createStandingInstruction(
        siDeps(env),
        {
            ownerUserId: owner.id,
            fromAccountId: fromAcc.id,
            beneficiaryId: beneficiary.id,
            amountMinor: 2500,
            currency: "INR",
            frequency: "daily",
            startAt: env.clock.now(),
        }
    );
    // Make it due: clock at or past nextRunAt.
    env.clock.advance(1000);

    const r1 = runDueInstructions({
        db: env.db,
        clock: env.clock,
        ids: env.ids,
        bus: env.bus,
        siRepo: env.repos.standingInstructions,
        beneficiaries: env.repos.beneficiaries,
    });
    assert.equal(r1.totalDue, 1);
    assert.equal(r1.succeeded, 1);
    assert.equal(r1.failed, 0);

    const updated = env.repos.standingInstructions.findById(si.id)!;
    assert.notDeepEqual(updated.nextRunAt, si.nextRunAt);
    assert.ok(updated.lastRunAt instanceof Date);

    // Re-running before the new nextRunAt yields no due rows.
    const r2 = runDueInstructions({
        db: env.db,
        clock: env.clock,
        ids: env.ids,
        bus: env.bus,
        siRepo: env.repos.standingInstructions,
        beneficiaries: env.repos.beneficiaries,
    });
    assert.equal(r2.totalDue, 0);

    // Receiving account got credited the amount once.
    const reread = env.repos.accounts.findById(toAcc.id)!;
    assert.equal(reread.balanceMinor, 2500);
});
