-- Backfills contributors.stellar_address for environments whose migration history
-- predates it (it already exists on production, added out-of-band) — IF NOT EXISTS
-- makes this safe to run on both a fresh local DB and production.
ALTER TABLE "contributors" ADD COLUMN IF NOT EXISTS "stellar_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "round_ups_tx_hash_unique" ON "round_ups" USING btree ("tx_hash") WHERE "round_ups"."tx_hash" != '';
