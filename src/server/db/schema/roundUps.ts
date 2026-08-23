import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contributors } from './contributors';
import { vaultPool } from './vaultPool';

/**
 * A single round-up contribution: the spare change from one purchase, routed via SEP-7
 * into the shared vault and attributed to a contributor via their muxed address.
 */
export const roundUps = pgTable('round_ups', {
  id: uuid('id').primaryKey().defaultRandom(),
  contributorId: uuid('contributor_id')
    .notNull()
    .references(() => contributors.id, { onDelete: 'cascade' }),
  vaultId: uuid('vault_id')
    .notNull()
    .references(() => vaultPool.id, { onDelete: 'cascade' }),
  // The original purchase amount in USDC.
  purchaseUsdc: text('purchase_usdc').notNull(),
  // The spare change routed into the vault (purchase rounded up minus purchase).
  contributionUsdc: text('contribution_usdc').notNull(),
  // The muxed M-address the round-up settled to (SEP-23 attribution).
  muxedAddress: text('muxed_address').notNull().default(''),
  txHash: text('tx_hash').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type RoundUp = typeof roundUps.$inferSelect;
export type NewRoundUp = typeof roundUps.$inferInsert;
