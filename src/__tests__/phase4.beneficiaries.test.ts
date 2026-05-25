import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import {
    addBeneficiary,
    removeBeneficiary,
    touchBeneficiaryByAccount,
} from "../contexts/beneficiaries/application/manageBeneficiary";
import {
    BeneficiaryAlreadyExistsError,
    BeneficiaryNotFoundError,
    BeneficiarySelfTargetError,
    BeneficiaryUnknownAccountError,
} from "../contexts/beneficiaries/domain/errors";

test("addBeneficiary stores nickname + counterparty username snapshot", () => {
    const env = makeTestEnv();
    const owner = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const target = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "bob"
    );
    createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        owner.id
    );
    const targetAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        target.id
    );

    const b = addBeneficiary(
        {
            repo: env.repos.beneficiaries,
            accounts: env.repos.accounts,
            users: env.repos.users,
            ids: env.ids,
            clock: env.clock,
        },
        { ownerUserId: owner.id, nickname: "Bobby", accountNumber: targetAcc.accountNumber }
    );

    assert.equal(b.nickname, "Bobby");
    assert.equal(b.accountNumber, targetAcc.accountNumber);
    assert.equal(b.beneficiaryUsername, "bob");
});

test("addBeneficiary rejects unknown account, self target, and duplicates", () => {
    const env = makeTestEnv();
    const owner = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const ownAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        owner.id
    );
    const target = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "bob"
    );
    const tAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        target.id
    );

    const deps = {
        repo: env.repos.beneficiaries,
        accounts: env.repos.accounts,
        users: env.repos.users,
        ids: env.ids,
        clock: env.clock,
    };

    assert.throws(
        () =>
            addBeneficiary(deps, {
                ownerUserId: owner.id,
                nickname: "Ghost",
                accountNumber: "SBE-9999999999",
            }),
        BeneficiaryUnknownAccountError
    );
    assert.throws(
        () =>
            addBeneficiary(deps, {
                ownerUserId: owner.id,
                nickname: "Self",
                accountNumber: ownAcc.accountNumber,
            }),
        BeneficiarySelfTargetError
    );
    addBeneficiary(deps, {
        ownerUserId: owner.id,
        nickname: "Bobby",
        accountNumber: tAcc.accountNumber,
    });
    assert.throws(
        () =>
            addBeneficiary(deps, {
                ownerUserId: owner.id,
                nickname: "Bobby Again",
                accountNumber: tAcc.accountNumber,
            }),
        BeneficiaryAlreadyExistsError
    );
});

test("touchBeneficiaryByAccount updates lastUsedAt; remove deletes", () => {
    const env = makeTestEnv();
    const owner = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "alice"
    );
    const target = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "bob"
    );
    createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        owner.id
    );
    const tAcc = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        target.id
    );

    const b = addBeneficiary(
        {
            repo: env.repos.beneficiaries,
            accounts: env.repos.accounts,
            users: env.repos.users,
            ids: env.ids,
            clock: env.clock,
        },
        { ownerUserId: owner.id, nickname: "Bobby", accountNumber: tAcc.accountNumber }
    );
    assert.equal(b.lastUsedAt, undefined);

    env.clock.advance(60_000);
    touchBeneficiaryByAccount(
        { repo: env.repos.beneficiaries, clock: env.clock },
        { ownerUserId: owner.id, accountNumber: tAcc.accountNumber }
    );
    const reread = env.repos.beneficiaries.findById(b.id)!;
    assert.ok(reread.lastUsedAt instanceof Date);

    removeBeneficiary(
        { repo: env.repos.beneficiaries },
        { ownerUserId: owner.id, beneficiaryId: b.id }
    );
    assert.equal(env.repos.beneficiaries.findById(b.id), undefined);
    assert.throws(
        () =>
            removeBeneficiary(
                { repo: env.repos.beneficiaries },
                { ownerUserId: owner.id, beneficiaryId: b.id }
            ),
        BeneficiaryNotFoundError
    );
});
