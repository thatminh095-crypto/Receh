CREATE TYPE "public"."contributor_role" AS ENUM('merchant', 'shopper');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('voting', 'approved', 'rejected', 'disbursed');--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" "contributor_role" DEFAULT 'shopper' NOT NULL,
	"cause" text DEFAULT '' NOT NULL,
	"mux_index" integer NOT NULL,
	"total_contributed_usdc" text DEFAULT '0' NOT NULL,
	"round_up_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grant_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"title" text NOT NULL,
	"organization" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"payout_address" text NOT NULL,
	"requested_usdc" text NOT NULL,
	"vote_weight_usdc" text DEFAULT '0' NOT NULL,
	"status" "proposal_status" DEFAULT 'voting' NOT NULL,
	"disburse_tx_hash" text DEFAULT '' NOT NULL,
	"voting_closes_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horizon_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"contributor_id" uuid,
	"proposal_id" uuid,
	"event_type" text DEFAULT 'roundup' NOT NULL,
	"amount" text DEFAULT '0' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"tx_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contributor_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"purchase_usdc" text NOT NULL,
	"contribution_usdc" text NOT NULL,
	"muxed_address" text DEFAULT '' NOT NULL,
	"tx_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_pool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'Receh Community Vault' NOT NULL,
	"vault_address" text NOT NULL,
	"vault_contract_id" text DEFAULT '' NOT NULL,
	"principal_usdc" text DEFAULT '0' NOT NULL,
	"accrued_yield_usdc" text DEFAULT '0' NOT NULL,
	"apy_percent" text DEFAULT '7.50' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"contributor_id" uuid NOT NULL,
	"weight_usdc" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_proposal_contributor" UNIQUE("proposal_id","contributor_id")
);
--> statement-breakpoint
ALTER TABLE "grant_proposals" ADD CONSTRAINT "grant_proposals_vault_id_vault_pool_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault_pool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_ups" ADD CONSTRAINT "round_ups_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_ups" ADD CONSTRAINT "round_ups_vault_id_vault_pool_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vault_pool"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_proposal_id_grant_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."grant_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE cascade ON UPDATE no action;