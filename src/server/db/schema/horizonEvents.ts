import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const horizonEvents = pgTable('horizon_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  vaultId: uuid('vault_id').notNull(),
  contributorId: uuid('contributor_id'),
  proposalId: uuid('proposal_id'),
  // 'roundup' | 'yield' | 'disburse' | 'heartbeat'
  eventType: text('event_type').notNull().default('roundup'),
  amount: text('amount').notNull().default('0'),
  label: text('label').notNull().default(''),
  txHash: text('tx_hash').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type HorizonEvent = typeof horizonEvents.$inferSelect;
export type NewHorizonEvent = typeof horizonEvents.$inferInsert;
