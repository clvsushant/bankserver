/**
 * Idempotent migration runner. We use raw SQL `CREATE TABLE IF NOT EXISTS`
 * statements derived from the Drizzle schema so the demo can run without
 * having to generate / apply migration files.
 *
 * For a production project, switch this to `drizzle-kit generate` +
 * `migrate` from `drizzle-orm/better-sqlite3/migrator`.
 */

import { sqlite } from "./client";

const ddl = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'customer',
    account_status TEXT NOT NULL DEFAULT 'Active',
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    passkey_enrolled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (username);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT,
    device_type TEXT NOT NULL,
    backed_up INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    label TEXT
);
CREATE INDEX IF NOT EXISTS webauthn_by_user ON webauthn_credentials (user_id);

CREATE TABLE IF NOT EXISTS recovery_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    issued_by_admin_id TEXT REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    purpose TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_by_user ON recovery_codes (user_id, consumed_at);

CREATE TABLE IF NOT EXISTS kyc_applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    dob TEXT NOT NULL,
    pan TEXT NOT NULL,
    address TEXT NOT NULL,
    doc_b64 TEXT,
    requested_account_type TEXT NOT NULL DEFAULT 'savings',
    status TEXT NOT NULL DEFAULT 'Submitted',
    submitted_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by_user_id TEXT REFERENCES users(id),
    reject_reason TEXT
);
CREATE INDEX IF NOT EXISTS kyc_by_user ON kyc_applications (user_id);
CREATE INDEX IF NOT EXISTS kyc_by_status ON kyc_applications (status);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    account_number TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_type TEXT NOT NULL DEFAULT 'savings',
    status TEXT NOT NULL DEFAULT 'Active',
    balance_minor INTEGER NOT NULL DEFAULT 0,
    hold_balance_minor INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'INR',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_by_user ON accounts (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_number_uq ON accounts (account_number);

CREATE TABLE IF NOT EXISTS beneficiaries (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    account_number TEXT NOT NULL,
    beneficiary_username TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    activated_at INTEGER,
    verified_at INTEGER,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS external_beneficiaries (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    account_number TEXT NOT NULL,
    ifsc TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    beneficiary_name TEXT NOT NULL,
    vpa TEXT,
    preferred_rail TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    activated_at INTEGER,
    verified_at INTEGER,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS ext_beneficiaries_by_owner ON external_beneficiaries (owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ext_beneficiaries_owner_acc_ifsc_uq
    ON external_beneficiaries (owner_user_id, account_number, ifsc);

CREATE TABLE IF NOT EXISTS fixed_deposits (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payout_account_id TEXT NOT NULL REFERENCES accounts(id),
    principal_minor INTEGER NOT NULL,
    tenure_months INTEGER NOT NULL,
    interest_rate_bps INTEGER NOT NULL,
    opened_at INTEGER NOT NULL,
    maturity_at INTEGER NOT NULL,
    auto_renew INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    closed_at INTEGER,
    interest_paid_minor INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS fd_by_user ON fixed_deposits (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS fd_by_account_uq ON fixed_deposits (account_id);
CREATE INDEX IF NOT EXISTS fd_by_maturity ON fixed_deposits (status, maturity_at);

CREATE TABLE IF NOT EXISTS nominees (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    relation TEXT NOT NULL,
    share_percent INTEGER NOT NULL DEFAULT 100,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS nominees_by_account ON nominees (account_id);
CREATE INDEX IF NOT EXISTS beneficiaries_by_owner ON beneficiaries (owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS beneficiaries_owner_acc_uq
    ON beneficiaries (owner_user_id, account_number);

CREATE TABLE IF NOT EXISTS billers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    biller_account_number TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS billers_acc_uq ON billers (biller_account_number);

CREATE TABLE IF NOT EXISTS standing_instructions (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    beneficiary_id TEXT NOT NULL REFERENCES beneficiaries(id) ON DELETE CASCADE,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    frequency TEXT NOT NULL,
    next_run_at INTEGER NOT NULL,
    last_run_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    description TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS si_by_owner ON standing_instructions (owner_user_id);
CREATE INDEX IF NOT EXISTS si_by_next_run ON standing_instructions (status, next_run_at);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read_at INTEGER,
    related_entity_type TEXT,
    related_entity_id TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_by_user ON notifications (user_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_by_unread ON notifications (user_id, read_at);

CREATE TABLE IF NOT EXISTS debit_cards (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    masked_number TEXT NOT NULL,
    network TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    issued_at INTEGER NOT NULL,
    frozen_at INTEGER,
    cancelled_at INTEGER,
    per_txn_limit_minor INTEGER NOT NULL DEFAULT 1000000,
    daily_limit_minor INTEGER NOT NULL DEFAULT 2500000,
    monthly_limit_minor INTEGER NOT NULL DEFAULT 25000000
);
CREATE INDEX IF NOT EXISTS debit_cards_by_account ON debit_cards (account_id);

CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT,
    from_account_id TEXT REFERENCES accounts(id),
    to_account_id TEXT REFERENCES accounts(id),
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    memo TEXT,
    kind TEXT NOT NULL DEFAULT 'transfer',
    status TEXT NOT NULL DEFAULT 'posted',
    rail TEXT NOT NULL DEFAULT 'internal',
    utr TEXT,
    failure_reason TEXT,
    posted_at INTEGER NOT NULL,
    reference_number TEXT,
    fee_minor INTEGER NOT NULL DEFAULT 0,
    category TEXT,
    from_account_number TEXT,
    to_account_number TEXT,
    from_username TEXT,
    to_username TEXT,
    description TEXT,
    biller_id TEXT,
    card_id TEXT REFERENCES debit_cards(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS transfers_idem_uq ON transfers (idempotency_key);
CREATE INDEX IF NOT EXISTS transfers_by_from ON transfers (from_account_id);
CREATE INDEX IF NOT EXISTS transfers_by_to ON transfers (to_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS transfers_ref_uq ON transfers (reference_number);
CREATE INDEX IF NOT EXISTS transfers_by_card ON transfers (card_id, posted_at);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    transfer_id TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    running_balance_minor INTEGER NOT NULL,
    posted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_by_account ON ledger_entries (account_id);
CREATE INDEX IF NOT EXISTS ledger_by_transfer ON ledger_entries (transfer_id);
CREATE INDEX IF NOT EXISTS ledger_by_account_posted ON ledger_entries (account_id, posted_at);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    occurred_at INTEGER NOT NULL,
    actor_user_id TEXT REFERENCES users(id),
    actor_username TEXT,
    actor_role TEXT NOT NULL,
    session_id TEXT,
    action TEXT NOT NULL,
    category TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    status TEXT NOT NULL,
    error_code TEXT,
    summary TEXT NOT NULL,
    payload TEXT,
    request_id TEXT,
    ip TEXT,
    user_agent TEXT,
    prev_hash TEXT,
    hash TEXT NOT NULL,
    seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_by_actor ON audit_log (actor_user_id, occurred_at);
CREATE INDEX IF NOT EXISTS audit_by_action ON audit_log (action, occurred_at);
CREATE INDEX IF NOT EXISTS audit_by_target ON audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_by_time ON audit_log (occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS audit_by_seq_uq ON audit_log (seq);

CREATE TABLE IF NOT EXISTS disputes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transfer_id TEXT NOT NULL REFERENCES transfers(id),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    admin_note TEXT,
    reversal_transfer_id TEXT REFERENCES transfers(id),
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by_user_id TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS disputes_by_user ON disputes (user_id);
CREATE INDEX IF NOT EXISTS disputes_by_transfer ON disputes (transfer_id);

CREATE TABLE IF NOT EXISTS admin_pending_actions (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    requested_by_user_id TEXT NOT NULL REFERENCES users(id),
    approved_by_user_id TEXT REFERENCES users(id),
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS admin_pending_by_status ON admin_pending_actions (status, created_at);
`;

/**
 * Columns added in later phases. Each runs as a separate ALTER TABLE so we
 * can swallow the "duplicate column name" error from sqlite when the column
 * already exists (idempotency). Sentinel values are chosen so existing rows
 * remain operable through the dev bypass — but they cannot log in via the
 * password flow until reset.
 */
const upgrades: Array<{ table: string; column: string; ddl: string }> = [
    { table: "users", column: "email", ddl: "ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''" },
    {
        table: "users",
        column: "password_hash",
        ddl: "ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''",
    },
    {
        table: "users",
        column: "account_status",
        ddl: "ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'Active'",
    },
    {
        table: "users",
        column: "failed_attempts",
        ddl: "ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0",
    },
    {
        table: "users",
        column: "locked_until",
        ddl: "ALTER TABLE users ADD COLUMN locked_until INTEGER",
    },
    {
        table: "users",
        column: "passkey_enrolled",
        ddl: "ALTER TABLE users ADD COLUMN passkey_enrolled INTEGER NOT NULL DEFAULT 0",
    },
    {
        table: "transfers",
        column: "reference_number",
        ddl: "ALTER TABLE transfers ADD COLUMN reference_number TEXT",
    },
    {
        table: "transfers",
        column: "fee_minor",
        ddl: "ALTER TABLE transfers ADD COLUMN fee_minor INTEGER NOT NULL DEFAULT 0",
    },
    {
        table: "transfers",
        column: "category",
        ddl: "ALTER TABLE transfers ADD COLUMN category TEXT",
    },
    {
        table: "transfers",
        column: "from_account_number",
        ddl: "ALTER TABLE transfers ADD COLUMN from_account_number TEXT",
    },
    {
        table: "transfers",
        column: "to_account_number",
        ddl: "ALTER TABLE transfers ADD COLUMN to_account_number TEXT",
    },
    {
        table: "transfers",
        column: "from_username",
        ddl: "ALTER TABLE transfers ADD COLUMN from_username TEXT",
    },
    {
        table: "transfers",
        column: "to_username",
        ddl: "ALTER TABLE transfers ADD COLUMN to_username TEXT",
    },
    {
        table: "transfers",
        column: "description",
        ddl: "ALTER TABLE transfers ADD COLUMN description TEXT",
    },
    // Phase 4 — multi-account-types + cross-cutting columns.
    {
        table: "accounts",
        column: "account_type",
        ddl: "ALTER TABLE accounts ADD COLUMN account_type TEXT NOT NULL DEFAULT 'savings'",
    },
    {
        table: "kyc_applications",
        column: "requested_account_type",
        ddl: "ALTER TABLE kyc_applications ADD COLUMN requested_account_type TEXT NOT NULL DEFAULT 'savings'",
    },
    {
        table: "webauthn_credentials",
        column: "last_used_at",
        ddl: "ALTER TABLE webauthn_credentials ADD COLUMN last_used_at INTEGER",
    },
    {
        table: "webauthn_credentials",
        column: "label",
        ddl: "ALTER TABLE webauthn_credentials ADD COLUMN label TEXT",
    },
    {
        table: "transfers",
        column: "biller_id",
        ddl: "ALTER TABLE transfers ADD COLUMN biller_id TEXT",
    },
    {
        table: "users",
        column: "kyc_tier",
        ddl: "ALTER TABLE users ADD COLUMN kyc_tier TEXT NOT NULL DEFAULT 'none'",
    },
    {
        table: "users",
        column: "mobile",
        ddl: "ALTER TABLE users ADD COLUMN mobile TEXT",
    },
    {
        table: "accounts",
        column: "hold_balance_minor",
        ddl: "ALTER TABLE accounts ADD COLUMN hold_balance_minor INTEGER NOT NULL DEFAULT 0",
    },
    {
        table: "beneficiaries",
        column: "status",
        ddl: "ALTER TABLE beneficiaries ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
    },
    {
        table: "beneficiaries",
        column: "activated_at",
        ddl: "ALTER TABLE beneficiaries ADD COLUMN activated_at INTEGER",
    },
    {
        table: "beneficiaries",
        column: "verified_at",
        ddl: "ALTER TABLE beneficiaries ADD COLUMN verified_at INTEGER",
    },
    {
        table: "transfers",
        column: "rail",
        ddl: "ALTER TABLE transfers ADD COLUMN rail TEXT NOT NULL DEFAULT 'internal'",
    },
    {
        table: "transfers",
        column: "utr",
        ddl: "ALTER TABLE transfers ADD COLUMN utr TEXT",
    },
    {
        table: "transfers",
        column: "failure_reason",
        ddl: "ALTER TABLE transfers ADD COLUMN failure_reason TEXT",
    },
    {
        table: "debit_cards",
        column: "per_txn_limit_minor",
        ddl: "ALTER TABLE debit_cards ADD COLUMN per_txn_limit_minor INTEGER NOT NULL DEFAULT 1000000",
    },
    {
        table: "debit_cards",
        column: "daily_limit_minor",
        ddl: "ALTER TABLE debit_cards ADD COLUMN daily_limit_minor INTEGER NOT NULL DEFAULT 2500000",
    },
    {
        table: "debit_cards",
        column: "monthly_limit_minor",
        ddl: "ALTER TABLE debit_cards ADD COLUMN monthly_limit_minor INTEGER NOT NULL DEFAULT 25000000",
    },
    {
        table: "transfers",
        column: "card_id",
        ddl: "ALTER TABLE transfers ADD COLUMN card_id TEXT REFERENCES debit_cards(id)",
    },
];

export function applyUpgradesTo(sqlite: { exec: (sql: string) => void }) {
    for (const up of upgrades) {
        try {
            sqlite.exec(up.ddl);
        } catch (e) {
            const msg = (e as Error).message || "";
            if (/duplicate column name/i.test(msg)) continue;
            throw e;
        }
    }
    sqlite.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS transfers_ref_uq ON transfers (reference_number)"
    );
    sqlite.exec(
        "CREATE INDEX IF NOT EXISTS transfers_by_card ON transfers (card_id, posted_at)"
    );
}

function applyUpgrades() {
    applyUpgradesTo(sqlite);
}

export function migrate(): void {
    sqlite.exec(ddl);
    applyUpgrades();
}

export const RAW_DDL = ddl;

if (require.main === module) {
    migrate();
    // eslint-disable-next-line no-console
    console.log("bankserver schema migrated.");
}
