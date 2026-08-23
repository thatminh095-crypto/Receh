import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The shared DeFindex yield vault that pools every round-up. A single row holds the
 * live state of the pool: principal deposited, accrued yield, the variable APY, and the
 * Stellar vault account that all SEP-7 round-ups settle to.
 */
export const vaultPool = pgTable('vault_pool', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default('Receh Community Vault'),
  vaultAddress: text('vault_address').notNull(),
  // DeFindex vault contract id (Soroban) — simulated when SDK unavailable.
  vaultContractId: text('vault_contract_id').notNull().default(''),
  // Sum of round-up principal deposited (USDC decimal string).
  principalUsdc: text('principal_usdc').notNull().default('0'),
  // Yield accrued so far (USDC decimal string).
  accruedYieldUsdc: text('accrued_yield_usdc').notNull().default('0'),
  // Current variable APY from the underlying Blend market (percent).
  apyPercent: text('apy_percent').notNull().default('7.50'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type VaultPool = typeof vaultPool.$inferSelect;
export type NewVaultPool = typeof vaultPool.$inferInsert;
