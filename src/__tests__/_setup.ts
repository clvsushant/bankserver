import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import { RAW_DDL, applyUpgradesTo } from "../db/migrate";
import type { Db } from "../db/client";
import { makeUserRepo } from "../contexts/identity/infrastructure/userRepo";
import { makeCredentialRepo } from "../contexts/identity/infrastructure/credentialRepo";
import { makeRecoveryCodeRepo } from "../contexts/identity/infrastructure/recoveryCodeRepo";
import { makeKycRepo } from "../contexts/kyc/infrastructure/kycRepo";
import { makeAccountRepo } from "../contexts/accounts/infrastructure/accountRepo";
import { makeTransferRepo } from "../contexts/payments/infrastructure/transferRepo";
import { makeLedgerRepo } from "../contexts/payments/infrastructure/ledgerRepo";
import { makeBeneficiaryRepo } from "../contexts/beneficiaries/infrastructure/beneficiaryRepo";
import { makeBillerRepo } from "../contexts/bills/infrastructure/billerRepo";
import { makeStandingInstructionRepo } from "../contexts/standingInstructions/infrastructure/standingInstructionRepo";
import { makeNotificationRepo } from "../contexts/notifications/infrastructure/notificationRepo";
import { makeDebitCardRepo } from "../contexts/cards/infrastructure/debitCardRepo";
import { makeAuditRepo } from "../contexts/audit/infrastructure/auditRepo";
import { makeFixedDepositRepo } from "../contexts/accounts/infrastructure/fixedDepositRepo";
import { makeNomineeRepo } from "../contexts/accounts/infrastructure/nomineeRepo";
import { makeExternalBeneficiaryRepo } from "../contexts/beneficiaries/infrastructure/externalBeneficiaryRepo";
import { makeDisputeRepo } from "../contexts/payments/infrastructure/disputeRepo";
import { createBus } from "../shared/eventBus";
import type { Clock } from "../shared/clock";
import type { IdGenerator } from "../shared/ids";
import { findOrCreateUser } from "../contexts/identity/application/registerUser";
import { submitKyc } from "../contexts/kyc/application/submitKyc";
import { approveKyc } from "../contexts/kyc/application/decideKyc";
import { open } from "../contexts/accounts/domain/account";
import { CARD_MERCHANT_BILLER_NAME } from "../services/cardLimits";

export interface TestEnv {
    db: Db;
    clock: { now: () => Date; set: (d: Date) => void; advance: (ms: number) => void };
    ids: IdGenerator;
    bus: ReturnType<typeof createBus>;
    repos: {
        users: ReturnType<typeof makeUserRepo>;
        credentials: ReturnType<typeof makeCredentialRepo>;
        recoveryCodes: ReturnType<typeof makeRecoveryCodeRepo>;
        kyc: ReturnType<typeof makeKycRepo>;
        accounts: ReturnType<typeof makeAccountRepo>;
        transfers: ReturnType<typeof makeTransferRepo>;
        ledger: ReturnType<typeof makeLedgerRepo>;
        beneficiaries: ReturnType<typeof makeBeneficiaryRepo>;
        billers: ReturnType<typeof makeBillerRepo>;
        standingInstructions: ReturnType<typeof makeStandingInstructionRepo>;
        notifications: ReturnType<typeof makeNotificationRepo>;
        cards: ReturnType<typeof makeDebitCardRepo>;
        audit: ReturnType<typeof makeAuditRepo>;
        fixedDeposits: ReturnType<typeof makeFixedDepositRepo>;
        nominees: ReturnType<typeof makeNomineeRepo>;
        externalBeneficiaries: ReturnType<typeof makeExternalBeneficiaryRepo>;
        disputes: ReturnType<typeof makeDisputeRepo>;
    };
}

let counter = 0;
let kycPanCounter = 0;

/** Marks a user as KYC-approved for tests that exercise banking APIs. */
export function grantBankingAccess(env: TestEnv, userId: string): void {
    if (env.repos.kyc.listByUserId(userId).some((a) => a.status === "Approved")) return;
    kycPanCounter += 1;
    const pan = `ABCDE${String(kycPanCounter).padStart(4, "0")}F`;
    const app = submitKyc(
        { repo: env.repos.kyc, ids: env.ids, clock: env.clock },
        {
            userId,
            fullName: "Test User",
            dob: "1990-01-15",
            pan,
            address: "Test Address",
        }
    );
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "banking-access-admin",
        "admin"
    );
    approveKyc(
        { repo: env.repos.kyc, users: env.repos.users, clock: env.clock, bus: env.bus },
        { applicationId: app.id, adminUserId: admin.id }
    );
}

/** Ensures the card merchant settlement biller exists (required for simulateCardSpend). */
export function ensureCardMerchantBiller(env: TestEnv): void {
    if (env.repos.billers.listAll().some((b) => b.name === CARD_MERCHANT_BILLER_NAME)) return;
    const admin = findOrCreateUser(
        { userRepo: env.repos.users, ids: env.ids, clock: env.clock },
        "card-merchant-admin",
        "admin"
    );
    const merchantAccount = open({
        id: env.ids.uuid(),
        accountNumber: env.ids.accountNumber(),
        userId: admin.id,
        accountType: "current",
        createdAt: env.clock.now(),
    });
    env.repos.accounts.insert(merchantAccount);
    env.repos.billers.insert({
        id: env.ids.uuid(),
        name: CARD_MERCHANT_BILLER_NAME,
        category: "other",
        billerAccountNumber: merchantAccount.accountNumber,
        active: true,
        createdAt: env.clock.now(),
    });
}

export function makeTestEnv(at: Date = new Date("2026-05-01T00:00:00Z")): TestEnv {
    const sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(RAW_DDL);
    applyUpgradesTo(sqlite);
    const db = drizzle(sqlite, { schema }) as unknown as Db;

    let now = at;
    const clock: Clock & { set(d: Date): void; advance(ms: number): void } = {
        now: () => now,
        set: (d: Date) => {
            now = d;
        },
        advance: (ms: number) => {
            now = new Date(now.getTime() + ms);
        },
    };

    counter = 0;
    const ids: IdGenerator = {
        uuid: () => {
            counter += 1;
            return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
        },
        accountNumber: () => {
            counter += 1;
            return `SBE-${String(counter).padStart(10, "0")}`;
        },
        transactionReference: () => {
            counter += 1;
            const hex = counter.toString(16).toUpperCase().padStart(8, "0");
            return `TXN-${hex.slice(0, 4)}-${hex.slice(4)}`;
        },
    };

    return {
        db,
        clock,
        ids,
        bus: createBus(),
        repos: {
            users: makeUserRepo(db),
            credentials: makeCredentialRepo(db),
            recoveryCodes: makeRecoveryCodeRepo(db),
            kyc: makeKycRepo(db),
            accounts: makeAccountRepo(db),
            transfers: makeTransferRepo(db),
            ledger: makeLedgerRepo(db),
            beneficiaries: makeBeneficiaryRepo(db),
            billers: makeBillerRepo(db),
            standingInstructions: makeStandingInstructionRepo(db),
            notifications: makeNotificationRepo(db),
            cards: makeDebitCardRepo(db),
            audit: makeAuditRepo(db),
            fixedDeposits: makeFixedDepositRepo(db),
            nominees: makeNomineeRepo(db),
            externalBeneficiaries: makeExternalBeneficiaryRepo(db),
            disputes: makeDisputeRepo(db),
        },
    };
}
