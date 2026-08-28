import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { contributors } from './contributors';
import { vaultPool } from './vaultPool';

/**
 * A single round-up contribution: the spare change from one purchase, routed on-chain
 * into the shared vault and attributed to a contributor via their muxed address.
 *
 * Column names say "usdc" for historical reasons — the vault currently holds XLM
 * directly (no USDC conversion), so these hold XLM amounts, not USDC ones.
 */
export const roundUps = pgTable(
  'round_ups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contributorId: uuid('contributor_id')
      .notNull()
      .references(() => contributors.id, { onDelete: 'cascade' }),
    vaultId: uuid('vault_id')
      .notNull()
      .references(() => vaultPool.id, { onDelete: 'cascade' }),
    // The original purchase amount.
    purchaseUsdc: text('purchase_usdc').notNull(),
    // The spare change routed into the vault (purchase rounded up minus purchase).
    contributionUsdc: text('contribution_usdc').notNull(),
    // The muxed M-address the round-up settled to (SEP-23 attribution).
    muxedAddress: text('muxed_address').notNull().default(''),
    txHash: text('tx_hash').notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // Same on-chain payment can only ever be credited once. Partial (excludes '')
    // so legacy/demo rows without a real hash never collide with each other.
    uniqueIndex('round_ups_tx_hash_unique').on(table.txHash).where(sql`${table.txHash} != ''`),
  ],
);

export type RoundUp = typeof roundUps.$inferSelect;
export type NewRoundUp = typeof roundUps.$inferInsert;
