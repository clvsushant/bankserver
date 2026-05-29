import { sqliteTable, text, integer, blob, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/**
 * Single-file schema. Each table is owned by exactly one bounded context;
 * the context's infrastructure layer imports it from here. Centralizing
 * the schema avoids `drizzle-kit` having to crawl context folders and
 * keeps migrations deterministic.
 */

// ---------- Identity ----------

export const users = sqliteTable(
    "users",
    {
        id: text("id").primaryKey(),
        username: text("username").notNull(),
        email: text("email").notNull().default(""),
        passwordHash: text("password_hash").notNull().default(""),
        role: text("role", { enum: ["customer", "admin"] }).notNull().default("customer"),
        // Account state. "Locked" is set after too many failed password
        // attempts; admins can clear it from /admin/users.
        accountStatus: text("account_status", { enum: ["Active", "Locked"] })
            .notNull()
            .default("Active"),
        failedAttempts: integer("failed_attempts").notNull().default(0),
        lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
        // Phase 1: passkey is required AFTER password. First-time logins set
        // this to true once registration completes.
        passkeyEnrolled: integer("passkey_enrolled", { mode: "boolean" })
            .notNull()
            .default(false),
        kycTier: text("kyc_tier", { enum: ["none", "basic", "full"] })
            .notNull()
            .default("none"),
        mobile: text("mobile"),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    },
    (t) => ({
        usernameIdx: uniqueIndex("users_username_uq").on(t.username),
    })
);

export const webauthnCredentials = sqliteTable(
    "webauthn_credentials",
    {
        id: text("id").primaryKey(), // base64url credential id
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        publicKey: blob("public_key", { mode: "buffer" }).notNull(),
        counter: integer("counter").notNull(),
        transports: text("transports"), // JSON-encoded string[]
        deviceType: text("device_type", { enum: ["singleDevice", "multiDevice"] }).notNull(),
        backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
        // Phase 4 #1 — settings UI surfaces these.
        lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
        label: text("label"),
    },
    (t) => ({
        byUser: index("webauthn_by_user").on(t.userId),
    })
);

// Admin-issued one-shot codes that let a user (who has lost access to all
// their existing passkeys) bootstrap an additional passkey on a new device.
// `codeHash` is a bcrypt of the random plaintext that was returned to the
// admin exactly once.
export const recoveryCodes = sqliteTable(
    "recovery_codes",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        codeHash: text("code_hash").notNull(),
        issuedAt: integer("issued_at", { mode: "timestamp_ms" }).notNull(),
        issuedByAdminId: text("issued_by_admin_id").references(() => users.id),
        expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
        consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
        purpose: text("purpose", { enum: ["passkey-add"] }).notNull(),
    },
    (t) => ({
        // Most reads filter by user + unconsumed (consumedAt IS NULL); this
        // composite index makes those scans cheap.
        byUser: index("recovery_by_user").on(t.userId, t.consumedAt),
    })
);

// ---------- KYC ----------

export const kycApplications = sqliteTable(
    "kyc_applications",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        fullName: text("full_name").notNull(),
        dob: text("dob").notNull(), // ISO date YYYY-MM-DD
        pan: text("pan").notNull(),
        address: text("address").notNull(),
        docB64: text("doc_b64"), // optional doc image base64 (placeholder)
        // Phase 4 #4 — type the customer applied for. Used by the
        // KycApproved subscriber to open an account of the right type.
        requestedAccountType: text("requested_account_type", {
            enum: ["savings", "current", "fixed_deposit"],
        })
            .notNull()
            .default("savings"),
        status: text("status", {
            enum: ["Submitted", "Approved", "Rejected"],
        })
            .notNull()
            .default("Submitted"),
        submittedAt: integer("submitted_at", { mode: "timestamp_ms" }).notNull(),
        decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
        decidedByUserId: text("decided_by_user_id").references(() => users.id),
        rejectReason: text("reject_reason"),
    },
    (t) => ({
        byUser: index("kyc_by_user").on(t.userId),
        byStatus: index("kyc_by_status").on(t.status),
    })
);

// ---------- Accounts ----------

export const accounts = sqliteTable(
    "accounts",
    {
        id: text("id").primaryKey(),
        accountNumber: text("account_number").notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        // Phase 4 #4 — savings (default), current, fixed_deposit.
        accountType: text("account_type", {
            enum: ["savings", "current", "fixed_deposit"],
        })
            .notNull()
            .default("savings"),
        status: text("status", { enum: ["Active", "Frozen", "Closed"] })
            .notNull()
            .default("Active"),
        balanceMinor: integer("balance_minor", { mode: "number" }).notNull().default(0),
        holdBalanceMinor: integer("hold_balance_minor", { mode: "number" }).notNull().default(0),
        currency: text("currency").notNull().default("INR"),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    },
    (t) => ({
        byUser: index("accounts_by_user").on(t.userId),
        byNumber: uniqueIndex("accounts_number_uq").on(t.accountNumber),
    })
);

// ---------- Beneficiaries (Phase 4 #2) ----------

export const beneficiaries = sqliteTable(
    "beneficiaries",
    {
        id: text("id").primaryKey(),
        ownerUserId: text("owner_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        nickname: text("nickname").notNull(),
        accountNumber: text("account_number").notNull(),
        // Snapshot of the username at time of save — kept for display even
        // if the counterparty later renames.
        beneficiaryUsername: text("beneficiary_username"),
        status: text("status", { enum: ["pending", "active"] }).notNull().default("pending"),
        activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
        verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
        lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    },
    (t) => ({
        byOwner: index("beneficiaries_by_owner").on(t.ownerUserId),
        ownerAccUq: uniqueIndex("beneficiaries_owner_acc_uq").on(t.ownerUserId, t.accountNumber),
    })
);

export const externalBeneficiaries = sqliteTable(
    "external_beneficiaries",
    {
        id: text("id").primaryKey(),
        ownerUserId: text("owner_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        nickname: text("nickname").notNull(),
        accountNumber: text("account_number").notNull(),
        ifsc: text("ifsc").notNull(),
        bankName: text("bank_name").notNull(),
        beneficiaryName: text("beneficiary_name").notNull(),
        vpa: text("vpa"),
        preferredRail: text("preferred_rail", {
            enum: ["imps", "neft", "rtgs", "upi"],
        }),
        status: text("status", { enum: ["pending", "active"] }).notNull().default("pending"),
        activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
        verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
        lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    },
    (t) => ({
        byOwner: index("ext_beneficiaries_by_owner").on(t.ownerUserId),
        ownerAccIfscUq: uniqueIndex("ext_beneficiaries_owner_acc_ifsc_uq").on(
            t.ownerUserId,
            t.accountNumber,
            t.ifsc
        ),
    })
);

export const fixedDeposits = sqliteTable(
    "fixed_deposits",
    {
        id: text("id").primaryKey(),
        accountId: text("account_id")
            .notNull()
            .references(() => accounts.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        payoutAccountId: text("payout_account_id")
            .notNull()
            .references(() => accounts.id),
        principalMinor: integer("principal_minor", { mode: "number" }).notNull(),
        tenureMonths: integer("tenure_months", { mode: "number" }).notNull(),
        interestRateBps: integer("interest_rate_bps", { mode: "number" }).notNull(),
        openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
        maturityAt: integer("maturity_at", { mode: "timestamp_ms" }).notNull(),
        autoRenew: integer("auto_renew", { mode: "boolean" }).notNull().default(false),
        status: text("status", {
            enum: ["active", "matured", "premature_closed"],
        })
            .notNull()
            .default("active"),
        closedAt: integer("closed_at", { mode: "timestamp_ms" }),
        interestPaidMinor: integer("interest_paid_minor", { mode: "number" }).notNull().default(0),
    },
    (t) => ({
        byUser: index("fd_by_user").on(t.userId),
        byAccount: uniqueIndex("fd_by_account_uq").on(t.accountId),
        byMaturity: index("fd_by_maturity").on(t.status, t.maturityAt),
    })
);

export const nominees = sqliteTable(
    "nominees",
    {
        id: text("id").primaryKey(),
        accountId: text("account_id")
            .notNull()
            .references(() => accounts.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        fullName: text("full_name").notNull(),
        relation: text("relation").notNull(),
        sharePercent: integer("share_percent", { mode: "number" }).notNull().default(100),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    },
    (t) => ({
        byAccount: index("nominees_by_account").on(t.accountId),
    })
);

// ---------- Billers (Phase 4 #6) ----------

export const billers = sqliteTable(
    "billers",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        category: text("category", {
            enum: ["electricity", "gas", "water", "internet", "mobile", "other"],
        }).notNull(),
        // The internal account that receives the bill payment. Created at
        // seed time so the existing transfer ledger can route to it.
        billerAccountNumber: text("biller_account_number").notNull(),
        active: integer("active", { mode: "boolean" }).notNull().default(true),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    },
    (t) => ({
        accUq: uniqueIndex("billers_acc_uq").on(t.billerAccountNumber),
    })
);

// ---------- Standing Instructions (Phase 4 #5) ----------

export const standingInstructions = sqliteTable(
    "standing_instructions",
    {
        id: text("id").primaryKey(),
        ownerUserId: text("owner_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        fromAccountId: text("from_account_id")
            .notNull()
            .references(() => accounts.id, { onDelete: "cascade" }),
        beneficiaryId: text("beneficiary_id")
            .notNull()
            .references(() => beneficiaries.id, { onDelete: "cascade" }),
        amountMinor: integer("amount_minor", { mode: "number" }).notNull(),
        currency: text("currency").notNull().default("INR"),
        frequency: text("frequency", { enum: ["daily", "weekly", "monthly"] }).notNull(),
        nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }).notNull(),
        lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
        status: text("status", { enum: ["active", "paused", "cancelled"] })
            .notNull()
            .default("active"),
        description: text("description"),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    },
    (t) => ({
        byOwner: index("si_by_owner").on(t.ownerUserId),
        byNext: index("si_by_next_run").on(t.status, t.nextRunAt),
    })
);

// ---------- Notifications (Phase 4 #7) ----------

export const notifications = sqliteTable(
    "notifications",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        kind: text("kind").notNull(),
        title: text("title").notNull(),
        body: text("body").notNull(),
        readAt: integer("read_at", { mode: "timestamp_ms" }),
        relatedEntityType: text("related_entity_type"),
        relatedEntityId: text("related_entity_id"),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    },
    (t) => ({
        byUser: index("notifications_by_user").on(t.userId, t.createdAt),
        byUnread: index("notifications_by_unread").on(t.userId, t.readAt),
    })
);

// ---------- Debit Cards (Phase 4 #8) ----------

export const debitCards = sqliteTable(
    "debit_cards",
    {
        id: text("id").primaryKey(),
        accountId: text("account_id")
            .notNull()
            .references(() => accounts.id, { onDelete: "cascade" }),
        maskedNumber: text("masked_number").notNull(),
        network: text("network", { enum: ["visa", "mastercard", "rupay"] }).notNull(),
        status: text("status", { enum: ["active", "frozen", "cancelled"] })
            .notNull()
            .default("active"),
        issuedAt: integer("issued_at", { mode: "timestamp_ms" }).notNull(),
        frozenAt: integer("frozen_at", { mode: "timestamp_ms" }),
        cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
        perTxnLimitMinor: integer("per_txn_limit_minor", { mode: "number" }).notNull(),
        dailyLimitMinor: integer("daily_limit_minor", { mode: "number" }).notNull(),
        monthlyLimitMinor: integer("monthly_limit_minor", { mode: "number" }).notNull(),
    },
    (t) => ({
        byAccount: index("debit_cards_by_account").on(t.accountId),
    })
);

// ---------- Payments / Ledger ----------

export const transfers = sqliteTable(
    "transfers",
    {
        id: text("id").primaryKey(),
        idempotencyKey: text("idempotency_key"),
        fromAccountId: text("from_account_id").references(() => accounts.id),
        toAccountId: text("to_account_id").references(() => accounts.id),
        amountMinor: integer("amount_minor", { mode: "number" }).notNull(),
        currency: text("currency").notNull().default("INR"),
        memo: text("memo"),
        kind: text("kind", { enum: ["transfer", "faucet", "reversal"] }).notNull().default("transfer"),
        status: text("status", { enum: ["pending", "posted", "failed"] }).notNull().default("posted"),
        rail: text("rail", {
            enum: ["internal", "imps", "neft", "rtgs", "upi"],
        })
            .notNull()
            .default("internal"),
        utr: text("utr"),
        failureReason: text("failure_reason"),
        postedAt: integer("posted_at", { mode: "timestamp_ms" }).notNull(),
        // Phase 3 — rich transaction summary. All snapshots are written
        // inside the same SQL transaction as the ledger entries so the
        // receipt is point-in-time consistent. Reference number is unique
        // among non-null values; pre-Phase-3 rows have NULL.
        referenceNumber: text("reference_number"),
        feeMinor: integer("fee_minor", { mode: "number" }).notNull().default(0),
        category: text("category", { enum: ["p2p", "self", "faucet", "bill", "card"] }),
        fromAccountNumber: text("from_account_number"),
        toAccountNumber: text("to_account_number"),
        fromUsername: text("from_username"),
        toUsername: text("to_username"),
        description: text("description"),
        // Phase 4 #6 — links a bill payment back to its biller.
        billerId: text("biller_id"),
        cardId: text("card_id").references(() => debitCards.id),
    },
    (t) => ({
        idemUq: uniqueIndex("transfers_idem_uq").on(t.idempotencyKey),
        byFrom: index("transfers_by_from").on(t.fromAccountId),
        byTo: index("transfers_by_to").on(t.toAccountId),
        byRef: uniqueIndex("transfers_ref_uq").on(t.referenceNumber),
        byCard: index("transfers_by_card").on(t.cardId, t.postedAt),
    })
);

export const ledgerEntries = sqliteTable(
    "ledger_entries",
    {
        id: text("id").primaryKey(),
        accountId: text("account_id")
            .notNull()
            .references(() => accounts.id, { onDelete: "cascade" }),
        transferId: text("transfer_id")
            .notNull()
            .references(() => transfers.id, { onDelete: "cascade" }),
        kind: text("kind", { enum: ["debit", "credit"] }).notNull(),
        amountMinor: integer("amount_minor", { mode: "number" }).notNull(),
        runningBalanceMinor: integer("running_balance_minor", { mode: "number" }).notNull(),
        postedAt: integer("posted_at", { mode: "timestamp_ms" }).notNull(),
    },
    (t) => ({
        byAccount: index("ledger_by_account").on(t.accountId),
        byTransfer: index("ledger_by_transfer").on(t.transferId),
        byAccountPosted: index("ledger_by_account_posted").on(t.accountId, t.postedAt),
    })
);

export const disputes = sqliteTable(
    "disputes",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        transferId: text("transfer_id")
            .notNull()
            .references(() => transfers.id),
        reason: text("reason").notNull(),
        status: text("status", {
            enum: ["submitted", "under_review", "approved", "rejected"],
        })
            .notNull()
            .default("submitted"),
        adminNote: text("admin_note"),
        reversalTransferId: text("reversal_transfer_id").references(() => transfers.id),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
        decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
        decidedByUserId: text("decided_by_user_id").references(() => users.id),
    },
    (t) => ({
        byUser: index("disputes_by_user").on(t.userId),
        byTransfer: index("disputes_by_transfer").on(t.transferId),
    })
);

export const adminPendingActions = sqliteTable(
    "admin_pending_actions",
    {
        id: text("id").primaryKey(),
        action: text("action").notNull(),
        requestedByUserId: text("requested_by_user_id")
            .notNull()
            .references(() => users.id),
        approvedByUserId: text("approved_by_user_id").references(() => users.id),
        payload: text("payload").notNull(),
        status: text("status", { enum: ["pending", "approved", "rejected", "executed"] })
            .notNull()
            .default("pending"),
        createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
        decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    },
    (t) => ({
        byStatus: index("admin_pending_by_status").on(t.status, t.createdAt),
    })
);

// ---------- Audit log ----------
//
// Append-only trail of every mutating action, every auth event, and every
// privileged admin read. Each row carries a hash chain (`prev_hash` ->
// `hash`) so tampering can be detected via /admin/audit/verify.

export const auditLog = sqliteTable(
    "audit_log",
    {
        id: text("id").primaryKey(),
        occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
        actorUserId: text("actor_user_id").references(() => users.id),
        actorUsername: text("actor_username"),
        actorRole: text("actor_role", {
            enum: ["customer", "admin", "system", "anonymous"],
        }).notNull(),
        sessionId: text("session_id"),
        action: text("action").notNull(),
        category: text("category", {
            enum: [
                "auth",
                "money",
                "kyc",
                "account",
                "beneficiary",
                "bill",
                "si",
                "card",
                "admin.read",
                "admin.write",
                "system",
            ],
        }).notNull(),
        targetType: text("target_type"),
        targetId: text("target_id"),
        status: text("status", { enum: ["success", "failure"] }).notNull(),
        errorCode: text("error_code"),
        summary: text("summary").notNull(),
        payload: text("payload"),
        requestId: text("request_id"),
        ip: text("ip"),
        userAgent: text("user_agent"),
        prevHash: text("prev_hash"),
        hash: text("hash").notNull(),
        // Monotonic id used to walk the chain in deterministic order even
        // when many entries share the same millisecond timestamp.
        seq: integer("seq").notNull(),
    },
    (t) => ({
        byActor: index("audit_by_actor").on(t.actorUserId, t.occurredAt),
        byAction: index("audit_by_action").on(t.action, t.occurredAt),
        byTarget: index("audit_by_target").on(t.targetType, t.targetId),
        byTime: index("audit_by_time").on(t.occurredAt),
        bySeq: uniqueIndex("audit_by_seq_uq").on(t.seq),
    })
);
