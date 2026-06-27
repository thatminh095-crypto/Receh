import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { contributors } from './contributors';
import { grantProposals } from './grantProposals';

/**
 * A vote cast by a contributor on a grant proposal. Voting power is weighted by the
 * contributor's accumulated round-up contributions (captured as weightUsdc at vote time).
 */
export const votes = pgTable(
  'votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => grantProposals.id, { onDelete: 'cascade' }),
    contributorId: uuid('contributor_id')
      .notNull()
      .references(() => contributors.id, { onDelete: 'cascade' }),
    // Voting weight = contributor's total contribution at the moment of voting.
    weightUsdc: text('weight_usdc').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniqueVote: unique('uniq_proposal_contributor').on(t.proposalId, t.contributorId),
  }),
);

export type Vote = typeof votes.$inferSelect;
export type NewVote = typeof votes.$inferInsert;
