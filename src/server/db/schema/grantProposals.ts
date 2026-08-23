import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { vaultPool } from './vaultPool';

export const proposalStatusEnum = pgEnum('proposal_status', [
  'voting',
  'approved',
  'rejected',
  'disbursed',
]);

/**
 * A monthly community grant proposal. Merchants and shoppers vote on which local projects
 * receive grants from the accrued pool + yield. The winning proposal is disbursed on-chain
 * from the DeFindex vault by the Soroban voting contract.
 */
export const grantProposals = pgTable('grant_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  vaultId: uuid('vault_id')
    .notNull()
    .references(() => vaultPool.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  organization: text('organization').notNull(),
  description: text('description').notNull().default(''),
  // Where the grant is disbursed if approved.
  payoutAddress: text('payout_address').notNull(),
  requestedUsdc: text('requested_usdc').notNull(),
  // Accumulated voting weight (sum of voter contributions) — set at window close.
  voteWeightUsdc: text('vote_weight_usdc').notNull().default('0'),
  status: proposalStatusEnum('status').notNull().default('voting'),
  // Tx hash of the on-chain disbursement once disbursed.
  disburseTxHash: text('disburse_tx_hash').notNull().default(''),
  votingClosesAt: timestamp('voting_closes_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type GrantProposal = typeof grantProposals.$inferSelect;
export type NewGrantProposal = typeof grantProposals.$inferInsert;
