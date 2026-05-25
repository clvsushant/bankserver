/**
 * Demo customer seeder. Creates 100 test customers (test_1 .. test_100) with
 * varied KYC outcomes:
 *
 *   - test_1   .. test_80   → KYC submitted, approved, account opened, faucet
 *                              deposit credited (₹1,000 .. ₹80,000).
 *   - test_81  .. test_90   → KYC submitted, then rejected with a reason.
 *   - test_91  .. test_100  → KYC submitted, still pending review.
 *
 * Account types cycle through savings / current / fixed_deposit so the queue
 * shows variety. The balance amount equals the index × ₹1,000 so the sort
 * order in the admin Accounts page is obvious.
 *
 * Idempotent: re-running rotates passwords for existing test_N users and
 * skips KYC / account creation if the user is already past the new state.
 *
 *   $ npm run db:seed:test-customers
 *
 * Login as any of these from the customer login screen using:
 *   username: test_${i}      (e.g. "test_1", "test_42")
 *   password: Test${i}@Pass123  (e.g. "Test1@Pass123", "Test42@Pass123")
 */

import { db } from "./client";
import { migrate } from "./migrate";
import { makeUserRepo } from "../contexts/identity/infrastructure/userRepo";
import { makeAccountRepo } from "../contexts/accounts/infrastructure/accountRepo";
import { makeKycRepo } from "../contexts/kyc/infrastructure/kycRepo";
import { systemIds } from "../shared/ids";
import { systemClock } from "../shared/clock";
import { createBus } from "../shared/eventBus";
import { hashPassword } from "../contexts/identity/application/passwords";
import { createUser } from "../contexts/identity/domain/user";
import {
    open as openAccount,
    type AccountType,
    ACCOUNT_TYPES,
} from "../contexts/accounts/domain/account";
import { submit as submitKyc, approve, reject } from "../contexts/kyc/domain/kycApplication";
import { faucetDeposit } from "../contexts/payments/application/faucetDeposit";

const TOTAL = 100;
const APPROVED_THROUGH = 80; // test_1 .. test_80 → approved
const REJECTED_THROUGH = 90; // test_81 .. test_90 → rejected; rest pending

const ADMIN_USERNAME = "Admin"; // matches src/db/seed.ts

const REJECT_REASONS = [
    "Document quality insufficient — please re-upload a clearer scan",
    "PAN number mismatch with submitted documents",
    "Address proof missing or expired",
    "Photo identification unclear",
    "Date of birth could not be verified",
];

function panFor(i: number): string {
    // Format: 5 letters + 4 digits + 1 letter (regex ^[A-Z]{5}[0-9]{4}[A-Z]$).
    const lastChar = String.fromCharCode(65 + ((i - 1) % 26)); // A..Z
    return `TESTA${String(i).padStart(4, "0")}${lastChar}`;
}

function dobFor(i: number): string {
    // ISO YYYY-MM-DD; spread birthdays across the years 1970..1999.
    const year = 1970 + (i % 30);
    const month = (i % 12) + 1;
    const day = (i % 27) + 1; // 1..27, safe across all months
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function accountTypeFor(i: number): AccountType {
    return ACCOUNT_TYPES[i % ACCOUNT_TYPES.length];
}

async function seedOne(
    i: number,
    adminUserId: string
): Promise<"created" | "rotated"> {
    const userRepo = makeUserRepo(db);
    const kycRepo = makeKycRepo(db);
    const accountRepo = makeAccountRepo(db);
    const seedBus = createBus(); // isolated — don't fire app-level subscribers

    const username = `test_${i}`;
    const email = `test_${i}@sentinel.bank`;
    const password = `Test${i}@Pass123`;

    let user = userRepo.findByUsername(username);
    let action: "created" | "rotated";

    if (user) {
        const hash = await hashPassword(password);
        userRepo.setPassword(user.id, hash);
        userRepo.setAccountStatus(user.id, "Active");
        action = "rotated";
    } else {
        const passwordHash = await hashPassword(password);
        user = createUser({
            id: systemIds.uuid(),
            username,
            email,
            passwordHash,
            role: "customer",
            passkeyEnrolled: false,
            createdAt: systemClock.now(),
        });
        userRepo.insert(user);
        action = "created";
    }

    const requestedAccountType = accountTypeFor(i);

    // KYC: only insert if the user has none yet. Otherwise leave existing
    // applications alone — re-running shouldn't pile up duplicates.
    const existingKyc = kycRepo.listByUserId(user.id);
    if (existingKyc.length === 0) {
        const app = submitKyc({
            id: systemIds.uuid(),
            userId: user.id,
            fullName: `Test User ${i}`,
            dob: dobFor(i),
            pan: panFor(i),
            address: `${100 + i} Demo Street, Test City`,
            requestedAccountType,
            submittedAt: systemClock.now(),
        });
        kycRepo.insert(app);

        if (i <= APPROVED_THROUGH) {
            const approved = approve(app, {
                adminUserId,
                at: systemClock.now(),
            });
            kycRepo.update(approved);
        } else if (i <= REJECTED_THROUGH) {
            const reason = REJECT_REASONS[i % REJECT_REASONS.length];
            const rejected = reject(app, {
                adminUserId,
                at: systemClock.now(),
                reason,
            });
            kycRepo.update(rejected);
        }
        // else: leave Submitted (pending review).
    }

    // Account + balance only for approved customers.
    if (i <= APPROVED_THROUGH) {
        const ownAccounts = accountRepo.listByUserId(user.id);
        let account = ownAccounts.find(
            (a) => a.accountType === requestedAccountType
        );
        if (!account) {
            account = openAccount({
                id: systemIds.uuid(),
                accountNumber: systemIds.accountNumber(),
                userId: user.id,
                accountType: requestedAccountType,
                createdAt: systemClock.now(),
            });
            accountRepo.insert(account);
        }

        // Faucet ₹i × 1000. Idempotency key keys on (user, slot) so re-runs
        // don't double-credit.
        const idempotencyKey = `seed:test_${i}:initial`;
        faucetDeposit(
            { db, clock: systemClock, ids: systemIds, bus: seedBus },
            {
                toAccountId: account.id,
                amountMinor: i * 1000 * 100, // i × ₹1,000 in paise
                currency: "INR",
                memo: `Initial demo balance for test_${i}`,
                idempotencyKey,
            }
        );
    }

    return action;
}

async function main() {
    migrate();

    const userRepo = makeUserRepo(db);
    const admin = userRepo.findByUsername(ADMIN_USERNAME);
    if (!admin) {
        // eslint-disable-next-line no-console
        console.error(
            `Admin user "${ADMIN_USERNAME}" not found. Run \`npm run db:seed\` first.`
        );
        process.exit(2);
    }

    let created = 0;
    let rotated = 0;

    // Bcrypt cost 12 — slow. Run each user sequentially but inside Promise
    // chunks of 4 so libuv worker threads stay busy without overwhelming the
    // SQLite write path.
    const CHUNK = 4;
    for (let start = 1; start <= TOTAL; start += CHUNK) {
        const slice = [];
        for (let i = start; i < start + CHUNK && i <= TOTAL; i++) {
            slice.push(seedOne(i, admin.id));
        }
        const results = await Promise.all(slice);
        for (const r of results) {
            if (r === "created") created++;
            else rotated++;
        }
        // eslint-disable-next-line no-console
        process.stdout.write(
            `\r  seeded ${Math.min(start + CHUNK - 1, TOTAL)} / ${TOTAL}...`
        );
    }
    process.stdout.write("\n");

    // eslint-disable-next-line no-console
    console.log(
        `\nTest customers ready (created=${created}, rotated=${rotated}).\n` +
            `  Approved + funded: test_1 .. test_${APPROVED_THROUGH}` +
            ` (₹1,000 .. ₹${(APPROVED_THROUGH * 1000).toLocaleString()})\n` +
            `  Rejected:          test_${APPROVED_THROUGH + 1} .. test_${REJECTED_THROUGH}\n` +
            `  Pending review:    test_${REJECTED_THROUGH + 1} .. test_${TOTAL}\n` +
            `\nLogin from the customer screen with username "test_<N>" and` +
            ` password "Test<N>@Pass123" (e.g. test_1 / Test1@Pass123).`
    );
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
