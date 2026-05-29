CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_number` text NOT NULL,
	`user_id` text NOT NULL,
	`account_type` text DEFAULT 'savings' NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`balance_minor` integer DEFAULT 0 NOT NULL,
	`hold_balance_minor` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_by_user` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_number_uq` ON `accounts` (`account_number`);--> statement-breakpoint
CREATE TABLE `admin_pending_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`approved_by_user_id` text,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `admin_pending_by_status` ON `admin_pending_actions` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` integer NOT NULL,
	`actor_user_id` text,
	`actor_username` text,
	`actor_role` text NOT NULL,
	`session_id` text,
	`action` text NOT NULL,
	`category` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`status` text NOT NULL,
	`error_code` text,
	`summary` text NOT NULL,
	`payload` text,
	`request_id` text,
	`ip` text,
	`user_agent` text,
	`prev_hash` text,
	`hash` text NOT NULL,
	`seq` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_by_actor` ON `audit_log` (`actor_user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_by_action` ON `audit_log` (`action`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_by_target` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `audit_by_time` ON `audit_log` (`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_by_seq_uq` ON `audit_log` (`seq`);--> statement-breakpoint
CREATE TABLE `beneficiaries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`nickname` text NOT NULL,
	`account_number` text NOT NULL,
	`beneficiary_username` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`activated_at` integer,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `beneficiaries_by_owner` ON `beneficiaries` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `beneficiaries_owner_acc_uq` ON `beneficiaries` (`owner_user_id`,`account_number`);--> statement-breakpoint
CREATE TABLE `billers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`biller_account_number` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billers_acc_uq` ON `billers` (`biller_account_number`);--> statement-breakpoint
CREATE TABLE `debit_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`masked_number` text NOT NULL,
	`network` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`issued_at` integer NOT NULL,
	`frozen_at` integer,
	`cancelled_at` integer,
	`per_txn_limit_minor` integer NOT NULL,
	`daily_limit_minor` integer NOT NULL,
	`monthly_limit_minor` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `debit_cards_by_account` ON `debit_cards` (`account_id`);--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`transfer_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`admin_note` text,
	`reversal_transfer_id` text,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by_user_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversal_transfer_id`) REFERENCES `transfers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `disputes_by_user` ON `disputes` (`user_id`);--> statement-breakpoint
CREATE INDEX `disputes_by_transfer` ON `disputes` (`transfer_id`);--> statement-breakpoint
CREATE TABLE `external_beneficiaries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`nickname` text NOT NULL,
	`account_number` text NOT NULL,
	`ifsc` text NOT NULL,
	`bank_name` text NOT NULL,
	`beneficiary_name` text NOT NULL,
	`vpa` text,
	`preferred_rail` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`activated_at` integer,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ext_beneficiaries_by_owner` ON `external_beneficiaries` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ext_beneficiaries_owner_acc_ifsc_uq` ON `external_beneficiaries` (`owner_user_id`,`account_number`,`ifsc`);--> statement-breakpoint
CREATE TABLE `fixed_deposits` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`payout_account_id` text NOT NULL,
	`principal_minor` integer NOT NULL,
	`tenure_months` integer NOT NULL,
	`interest_rate_bps` integer NOT NULL,
	`opened_at` integer NOT NULL,
	`maturity_at` integer NOT NULL,
	`auto_renew` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`closed_at` integer,
	`interest_paid_minor` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payout_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fd_by_user` ON `fixed_deposits` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fd_by_account_uq` ON `fixed_deposits` (`account_id`);--> statement-breakpoint
CREATE INDEX `fd_by_maturity` ON `fixed_deposits` (`status`,`maturity_at`);--> statement-breakpoint
CREATE TABLE `kyc_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`full_name` text NOT NULL,
	`dob` text NOT NULL,
	`pan` text NOT NULL,
	`address` text NOT NULL,
	`doc_b64` text,
	`requested_account_type` text DEFAULT 'savings' NOT NULL,
	`status` text DEFAULT 'Submitted' NOT NULL,
	`submitted_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by_user_id` text,
	`reject_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kyc_by_user` ON `kyc_applications` (`user_id`);--> statement-breakpoint
CREATE INDEX `kyc_by_status` ON `kyc_applications` (`status`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`transfer_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`running_balance_minor` integer NOT NULL,
	`posted_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_by_account` ON `ledger_entries` (`account_id`);--> statement-breakpoint
CREATE INDEX `ledger_by_transfer` ON `ledger_entries` (`transfer_id`);--> statement-breakpoint
CREATE INDEX `ledger_by_account_posted` ON `ledger_entries` (`account_id`,`posted_at`);--> statement-breakpoint
CREATE TABLE `nominees` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`full_name` text NOT NULL,
	`relation` text NOT NULL,
	`share_percent` integer DEFAULT 100 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `nominees_by_account` ON `nominees` (`account_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`read_at` integer,
	`related_entity_type` text,
	`related_entity_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_by_user` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_by_unread` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`issued_at` integer NOT NULL,
	`issued_by_admin_id` text,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`purpose` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issued_by_admin_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recovery_by_user` ON `recovery_codes` (`user_id`,`consumed_at`);--> statement-breakpoint
CREATE TABLE `standing_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`from_account_id` text NOT NULL,
	`beneficiary_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`frequency` text NOT NULL,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`beneficiary_id`) REFERENCES `beneficiaries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `si_by_owner` ON `standing_instructions` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `si_by_next_run` ON `standing_instructions` (`status`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text,
	`from_account_id` text,
	`to_account_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`memo` text,
	`kind` text DEFAULT 'transfer' NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`rail` text DEFAULT 'internal' NOT NULL,
	`utr` text,
	`failure_reason` text,
	`posted_at` integer NOT NULL,
	`reference_number` text,
	`fee_minor` integer DEFAULT 0 NOT NULL,
	`category` text,
	`from_account_number` text,
	`to_account_number` text,
	`from_username` text,
	`to_username` text,
	`description` text,
	`biller_id` text,
	`card_id` text,
	FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `debit_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_idem_uq` ON `transfers` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `transfers_by_from` ON `transfers` (`from_account_id`);--> statement-breakpoint
CREATE INDEX `transfers_by_to` ON `transfers` (`to_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_ref_uq` ON `transfers` (`reference_number`);--> statement-breakpoint
CREATE INDEX `transfers_by_card` ON `transfers` (`card_id`,`posted_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`password_hash` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'customer' NOT NULL,
	`account_status` text DEFAULT 'Active' NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`passkey_enrolled` integer DEFAULT false NOT NULL,
	`kyc_tier` text DEFAULT 'none' NOT NULL,
	`mobile` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uq` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `webauthn_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_key` blob NOT NULL,
	`counter` integer NOT NULL,
	`transports` text,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`label` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webauthn_by_user` ON `webauthn_credentials` (`user_id`);