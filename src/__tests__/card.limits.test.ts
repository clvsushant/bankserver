import test from "node:test";
import assert from "node:assert/strict";
import { makeTestEnv, grantBankingAccess, ensureCardMerchantBiller } from "./_setup";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { createAccountForUser } from "../contexts/accounts/application/createAccount";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";
import { setKycTier } from "../contexts/identity/application/kycTier";
import {
    issueCard,
    setCardLimits,
    freezeCard,
} from "../contexts/cards/application/manageCards";
import { simulateCardSpend } from "../contexts/cards/application/simulateCardSpend";
import {
    defaultLimitsForTier,
    previewCardLimits,
    bankMaxForTier,
} from "../services/cardLimits";
import {
    CardInvalidStateError,
    CardLimitAboveBankMaxError,
    CardLimitExceededError,
    CardPerTxnLimitError,
} from "../contexts/cards/domain/errors";

function cardDeps(env: ReturnType<typeof makeTestEnv>) {
    return {
        repo: env.repos.cards,
        accounts: env.repos.accounts,
        users: env.repos.users,
        ids: env.ids,
        clock: env.clock,
    };
}

function bankingSetup() {
    const env = makeTestEnv();
    const owner = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "card-limit-owner"
    );
    const account = createAccountForUser(
        { repo: env.repos.accounts, ids: env.ids, clock: env.clock },
        owner.id
    );
    grantBankingAccess(env, owner.id);
    setKycTier({ users: env.repos.users }, owner.id, "full");
    ensureCardMerchantBiller(env);
    let funded = 0;
    let n = 0;
    while (funded < 500_000_00) {
        const chunk = Math.min(100_000_00, 500_000_00 - funded);
        faucetDeposit(
            { db: env.db, clock: env.clock, ids: env.ids, bus: env.bus },
            {
                toAccountId: account.id,
                amountMinor: chunk,
                currency: "INR",
                idempotencyKey: `card-fund-${n++}`,
            }
        );
        funded += chunk;
    }
    const card = issueCard(cardDeps(env), {
        ownerUserId: owner.id,
        accountId: account.id,
        network: "visa",
    });
    return { env, owner, account, card };
}

test("issueCard applies tier-aware default limits", () => {
    const { env, owner, account, card } = bankingSetup();
    const expected = defaultLimitsForTier("full");
    assert.equal(card.perTxnLimitMinor, expected.perTxnLimitMinor);
    assert.equal(card.dailyLimitMinor, expected.dailyLimitMinor);
    assert.equal(card.monthlyLimitMinor, expected.monthlyLimitMinor);
    void owner;
    void account;
    void env;
});

test("setCardLimits rejects limits above bank max", () => {
    const { env, owner, card } = bankingSetup();
    const max = bankMaxForTier("full");
    assert.throws(
        () =>
            setCardLimits(
                { ...cardDeps(env), clock: env.clock },
                {
                    ownerUserId: owner.id,
                    cardId: card.id,
                    perTxnLimitMinor: max.perTxnLimitMinor + 1,
                    dailyLimitMinor: max.dailyLimitMinor,
                    monthlyLimitMinor: max.monthlyLimitMinor,
                }
            ),
        CardLimitAboveBankMaxError
    );
});

test("simulateCardSpend enforces per-txn, daily, and monthly limits", () => {
    const { env, owner, account, card } = bankingSetup();
    const spendDeps = {
        db: env.db,
        clock: env.clock,
        ids: env.ids,
        bus: env.bus,
        cards: env.repos.cards,
        accounts: env.repos.accounts,
        billers: env.repos.billers,
    };

    setCardLimits(
        { ...cardDeps(env), clock: env.clock },
        {
            ownerUserId: owner.id,
            cardId: card.id,
            perTxnLimitMinor: 5_000_00,
            dailyLimitMinor: 10_000_00,
            monthlyLimitMinor: 20_000_00,
        }
    );

    simulateCardSpend(spendDeps, {
        ownerUserId: owner.id,
        cardId: card.id,
        amountMinor: 3_000_00,
        currency: "INR",
        merchantName: "Demo Store",
    });

    assert.throws(
        () =>
            simulateCardSpend(spendDeps, {
                ownerUserId: owner.id,
                cardId: card.id,
                amountMinor: 6_000_00,
                currency: "INR",
            }),
        CardPerTxnLimitError
    );

    simulateCardSpend(spendDeps, {
        ownerUserId: owner.id,
        cardId: card.id,
        amountMinor: 4_000_00,
        currency: "INR",
        idempotencyKey: "card-spend-daily",
    });

    assert.throws(
        () =>
            simulateCardSpend(spendDeps, {
                ownerUserId: owner.id,
                cardId: card.id,
                amountMinor: 3_000_01,
                currency: "INR",
            }),
        CardLimitExceededError
    );

    const c = env.repos.cards.findById(card.id)!;
    const preview = previewCardLimits(env.db, {
        cardId: card.id,
        limits: {
            perTxnLimitMinor: c.perTxnLimitMinor,
            dailyLimitMinor: c.dailyLimitMinor,
            monthlyLimitMinor: c.monthlyLimitMinor,
        },
        now: env.clock.now(),
    });
    assert.equal(preview.dailyUsedMinor, 7_000_00);
    void account;
});

test("frozen card cannot spend", () => {
    const { env, owner, card } = bankingSetup();
    freezeCard(
        { repo: env.repos.cards, accounts: env.repos.accounts, clock: env.clock },
        { ownerUserId: owner.id, cardId: card.id }
    );
    assert.throws(
        () =>
            simulateCardSpend(
                {
                    db: env.db,
                    clock: env.clock,
                    ids: env.ids,
                    bus: env.bus,
                    cards: env.repos.cards,
                    accounts: env.repos.accounts,
                    billers: env.repos.billers,
                },
                {
                    ownerUserId: owner.id,
                    cardId: card.id,
                    amountMinor: 100_00,
                    currency: "INR",
                }
            ),
        CardInvalidStateError
    );
});
