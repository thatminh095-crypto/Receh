import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const contributorRoleEnum = pgEnum('contributor_role', ['merchant', 'shopper']);

export const contributors = pgTable('contributors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  role: contributorRoleEnum('role').notNull().default('shopper'),
  cause: text('cause').notNull().default(''),
  stellarAddress: text('stellar_address').notNull().default(''),
  muxIndex: integer('mux_index').notNull(),
  totalContributedUsdc: text('total_contributed_usdc').notNull().default('0'),
  roundUpCount: integer('round_up_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type Contributor = typeof contributors.$inferSelect;
export type NewContributor = typeof contributors.$inferInsert;