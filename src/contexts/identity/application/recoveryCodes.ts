import crypto from "crypto";
import bcrypt from "bcrypt";
import type { Clock } from "../../../shared/clock";
import type { IdGenerator } from "../../../shared/ids";
import type { EventBus } from "../../../shared/eventBus";
import type { RecoveryCode, RecoveryCodePurpose } from "../domain/recoveryCode";
import type { RecoveryCodeRepo, UserRepo } from "./ports";

const BCRYPT_COST = 10;
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Always run a bcrypt comparison even when no candidate codes exist so
 * `consumeRecoveryCode` takes roughly the same wall-clock time whether the
 * user has codes or not. A real bcrypt hash with a known dummy plaintext.
 */
const DUMMY_HASH = "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96BR6HIm0YbV0u6FbwvYmHjHj.";

export interface IssueDeps {
    repo: RecoveryCodeRepo;
    users: UserRepo;
    ids: IdGenerator;
    clock: Clock;
    bus?: EventBus;
}

export interface IssueArgs {
    userId: string;
    adminUserId: string;
    purpose?: RecoveryCodePurpose;
}

/**
 * Mints a fresh recovery code for the target user. Returns the *plaintext*
 * exactly once — caller must surface it to the admin and never persist it.
 *
 * Code format: `XXXX-XXXX-XXXX` (12 base32-ish chars, ~60 bits of entropy)
 * which is short enough to read aloud.
 */
export function issueRecoveryCode(
    deps: IssueDeps,
    args: IssueArgs
): { code: string; record: RecoveryCode } {
    const user = deps.users.findById(args.userId);
    if (!user) throw new Error("User not found");

    const purpose: RecoveryCodePurpose = args.purpose ?? "passkey-add";
    const plain = generateCode();
    const codeHash = bcrypt.hashSync(plain, BCRYPT_COST);
    const issuedAt = deps.clock.now();
    const record: RecoveryCode = {
        id: deps.ids.uuid(),
        userId: user.id,
        codeHash,
        issuedAt,
        issuedByAdminId: args.adminUserId,
        expiresAt: new Date(issuedAt.getTime() + TTL_MS),
        purpose,
    };
    deps.repo.insert(record);

    if (deps.bus) {
        deps.bus.publish([
            {
                type: "RecoveryCodeIssued",
                userId: user.id,
                username: user.username,
                recoveryId: record.id,
                issuedByAdminId: args.adminUserId,
                purpose,
                expiresAt: record.expiresAt,
                issuedAt,
            } as unknown as { type: string },
        ]);
    }

    return { code: plain, record };
}

export interface ConsumeDeps {
    repo: RecoveryCodeRepo;
    clock: Clock;
    bus?: EventBus;
}

export interface ConsumeArgs {
    userId: string;
    code: string;
    purpose?: RecoveryCodePurpose;
}

/**
 * Constant-time check: walks every active candidate code and bcrypt-compares
 * regardless of how many exist. Returns the consumed record on match.
 *
 * The compare-against-dummy branch keeps timing roughly equal when the user
 * has zero codes, which avoids leaking "user has an outstanding code" via
 * latency.
 */
export function consumeRecoveryCode(
    deps: ConsumeDeps,
    args: ConsumeArgs
): RecoveryCode | null {
    const purpose: RecoveryCodePurpose = args.purpose ?? "passkey-add";
    const now = deps.clock.now();
    const candidates = deps.repo
        .listActiveByUserId(args.userId, now)
        .filter((c) => c.purpose === purpose);

    let match: RecoveryCode | null = null;
    if (candidates.length === 0) {
        // Equalize timing.
        bcrypt.compareSync(args.code, DUMMY_HASH);
    } else {
        for (const c of candidates) {
            const ok = bcrypt.compareSync(args.code, c.codeHash);
            if (ok && !match) match = c;
        }
    }
    if (!match) return null;

    deps.repo.markConsumed(match.id, now);
    if (deps.bus) {
        deps.bus.publish([
            {
                type: "RecoveryCodeConsumed",
                userId: match.userId,
                recoveryId: match.id,
                purpose,
                consumedAt: now,
            } as unknown as { type: string },
        ]);
    }
    return { ...match, consumedAt: now };
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // crockford-ish, no 0/O/1/I

function generateCode(): string {
    // 12 chars from a 32-symbol alphabet ≈ 60 bits of entropy.
    const buf = crypto.randomBytes(12);
    let out = "";
    for (let i = 0; i < 12; i++) out += ALPHABET[buf[i]! & 31];
    return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}
