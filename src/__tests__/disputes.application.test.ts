import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { executeTransfer } from "../contexts/payments/application/executeTransfer";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";
import { fileDispute } from "../contexts/payments/application/disputes";
import {
    DisputeNotAuthorizedError,
    DisputeTransferNotFoundError,
} from "../contexts/payments/domain/disputeErrors";
import { translateDisputeDomainError } from "../shared/domainErrorTranslate";
import { ForbiddenError, NotFoundError } from "../utils/errors";

const SAVINGS_FUND = 100_000;

function bootstrap() {
    const env = makeTestEnv();
    const alice = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice-dispute"
    );
    const bob = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "bob-dispute"
    );
    const charlie = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "charlie-dispute"
    );
    const aAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        alice.id
    );
    const bAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        bob.id
    );
    return { env, alice, bob, charlie, aAcc, bAcc };
}

test("fileDispute allows sender to dispute their transfer", () => {
    const { env, alice, aAcc, bAcc } = bootstrap();
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: SAVINGS_FUND, currency: "INR" }
    );
    const t = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 5000,
            currency: "INR",
        }
    );
    const d = fileDispute(
        {
            disputes: env.repos.disputes,
            transfers: env.repos.transfers,
            accounts: env.repos.accounts,
            ids: env.ids,
            clock: env.clock,
        },
        { userId: alice.id, transferId: t.id, reason: "Wrong amount" }
    );
    assert.equal(d.userId, alice.id);
    assert.equal(d.transferId, t.id);
});

test("fileDispute allows recipient to dispute incoming transfer", () => {
    const { env, bob, aAcc, bAcc } = bootstrap();
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: SAVINGS_FUND, currency: "INR" }
    );
    const t = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 5000,
            currency: "INR",
        }
    );
    const d = fileDispute(
        {
            disputes: env.repos.disputes,
            transfers: env.repos.transfers,
            accounts: env.repos.accounts,
            ids: env.ids,
            clock: env.clock,
        },
        { userId: bob.id, transferId: t.id, reason: "Did not authorize" }
    );
    assert.equal(d.userId, bob.id);
});

test("fileDispute rejects user who is not party to the transfer", () => {
    const { env, alice, charlie, aAcc, bAcc } = bootstrap();
    faucetDeposit(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        { toAccountId: aAcc.id, amountMinor: SAVINGS_FUND, currency: "INR" }
    );
    const t = executeTransfer(
        { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
        {
            fromAccountId: aAcc.id,
            toAccountNumber: bAcc.accountNumber,
            amountMinor: 5000,
            currency: "INR",
        }
    );
    assert.throws(
        () =>
            fileDispute(
                {
                    disputes: env.repos.disputes,
                    transfers: env.repos.transfers,
                    accounts: env.repos.accounts,
                    ids: env.ids,
                    clock: env.clock,
                },
                { userId: charlie.id, transferId: t.id, reason: "Fraud" }
            ),
        DisputeNotAuthorizedError
    );
    const mapped = translateDisputeDomainError(new DisputeNotAuthorizedError());
    assert.ok(mapped instanceof ForbiddenError);
});

test("fileDispute rejects unknown transfer id", () => {
    const { env, alice } = bootstrap();
    assert.throws(
        () =>
            fileDispute(
                {
                    disputes: env.repos.disputes,
                    transfers: env.repos.transfers,
                    accounts: env.repos.accounts,
                    ids: env.ids,
                    clock: env.clock,
                },
                {
                    userId: alice.id,
                    transferId: "00000000-0000-0000-0000-000000009999",
                    reason: "Missing",
                }
            ),
        DisputeTransferNotFoundError
    );
    const mapped = translateDisputeDomainError(new DisputeTransferNotFoundError());
    assert.ok(mapped instanceof NotFoundError);
});
