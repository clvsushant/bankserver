/**
 * Demo seeder. Idempotent: re-running rotates the admin password to the
 * configured value but never duplicates the user.
 *
 *   $ npm run db:seed
 *
 * The seeded admin's `passkeyEnrolled` flag is false so the first sign-in
 * via /admin/login flows through passkey enrollment.
 *
 * NOTE: the password seeded here ("Admin@123") intentionally bypasses the
 * /identity/signup strength check (which requires 10+ chars). It's a
 * demo-only convenience for local testing — never replicate this pattern
 * in a real signup endpoint.
 */

import { db } from "./client";
import { migrate } from "./migrate";
import { makeUserRepo } from "../contexts/identity/infrastructure/userRepo";
import { makeAccountRepo } from "../contexts/accounts/infrastructure/accountRepo";
import { makeBillerRepo } from "../contexts/bills/infrastructure/billerRepo";
import { systemIds } from "../shared/ids";
import { systemClock } from "../shared/clock";
import { hashPassword } from "../contexts/identity/application/passwords";
import { createUser } from "../contexts/identity/domain/user";
import { open } from "../contexts/accounts/domain/account";
import type { BillerCategory } from "../contexts/bills/domain/biller";
import { CARD_MERCHANT_BILLER_NAME } from "../services/cardLimits";

const SEED_USERNAME = "Admin";
const SEED_EMAIL = "admin@sentinel.bank";
const SEED_PASSWORD = "Admin@123";
const SEED_ROLE = "admin" as const;

const BILLER_SEEDS: Array<{ name: string; category: BillerCategory }> = [
    { name: CARD_MERCHANT_BILLER_NAME, category: "other" },
    { name: "Sentinel Power Co.", category: "electricity" },
    { name: "GreenFlame Gas", category: "gas" },
    { name: "Aqua Munipality Water", category: "water" },
    { name: "FastNet Internet", category: "internet" },
    { name: "ProMobile Postpaid", category: "mobile" },
    { name: "City Property Tax", category: "other" },
];

async function seedAdmin() {
    const userRepo = makeUserRepo(db);
    const existing = userRepo.findByUsername(SEED_USERNAME);
    if (existing) {
        const hash = await hashPassword(SEED_PASSWORD);
        userRepo.setPassword(existing.id, hash);
        if (existing.role !== SEED_ROLE) userRepo.setRole(existing.id, SEED_ROLE);
        userRepo.setAccountStatus(existing.id, "Active");
        // eslint-disable-next-line no-console
        console.log(
            `Admin user already existed (id=${existing.id}); rotated password and cleared lockout.`
        );
        return existing;
    }

    const passwordHash = await hashPassword(SEED_PASSWORD);
    const user = createUser({
        id: systemIds.uuid(),
        username: SEED_USERNAME,
        email: SEED_EMAIL,
        passwordHash,
        role: SEED_ROLE,
        passkeyEnrolled: false,
        createdAt: systemClock.now(),
    });
    userRepo.insert(user);
    // eslint-disable-next-line no-console
    console.log(
        `Seeded admin: ${user.username} (id=${user.id})\n` +
            `  email:    ${user.email}\n` +
            `  password: ${SEED_PASSWORD}\n` +
            `  role:     ${user.role}\n` +
            `First sign-in at /admin/login will trigger passkey enrollment.`
    );
    return user;
}

/**
 * Each biller gets its own internal `billers` row plus a `billers/...`
 * account owned by the seed admin user that receives bill payments. Reusing
 * the existing accounts table lets the same `executeTransfer` ledger
 * machinery handle bill payments without a parallel transfer pipeline.
 */
function seedBillers(adminUserId: string) {
    const billerRepo = makeBillerRepo(db);
    const accountRepo = makeAccountRepo(db);
    const existing = billerRepo.listAll();
    if (existing.length >= BILLER_SEEDS.length) {
        // eslint-disable-next-line no-console
        console.log(`Billers already seeded (${existing.length} present).`);
        return;
    }
    for (const seed of BILLER_SEEDS) {
        const already = existing.find((b) => b.name === seed.name);
        if (already) continue;
        const billerAccount = open({
            id: systemIds.uuid(),
            accountNumber: systemIds.accountNumber(),
            userId: adminUserId,
            accountType: "current",
            createdAt: systemClock.now(),
        });
        accountRepo.insert(billerAccount);
        billerRepo.insert({
            id: systemIds.uuid(),
            name: seed.name,
            category: seed.category,
            billerAccountNumber: billerAccount.accountNumber,
            active: true,
            createdAt: systemClock.now(),
        });
    }
    // eslint-disable-next-line no-console
    console.log(`Seeded ${BILLER_SEEDS.length} billers.`);
}

async function main() {
    migrate();
    const admin = await seedAdmin();
    seedBillers(admin.id);
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
