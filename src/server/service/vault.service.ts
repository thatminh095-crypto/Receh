import { desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  contributors,
  grantProposals,
  type NewVaultPool,
  roundUps,
  vaultPool,
} from '@/server/db/schema';
import { AppError } from '@/server/lib/http';
import { projectYield } from '@/server/lib/roundup';

/** Return the single shared vault (first row). Throws if none seeded. */
export async function getVault() {
  const rows = await db.select().from(vaultPool).orderBy(desc(vaultPool.createdAt)).limit(1);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'Vault not initialised', 404);
  return rows[0];
}

export async function getVaultById(id: string) {
  const rows = await db.select().from(vaultPool).where(eq(vaultPool.id, id));
  if (!rows[0]) throw new AppError('NOT_FOUND', 'Vault not found', 404);
  return rows[0];
}

export async function createVault(data: NewVaultPool) {
  const rows = await db.insert(vaultPool).values(data).returning();
  return rows[0]!;
}

/**
 * Add a contribution to the vault principal and re-derive accrued yield.
 * Yield is the variable Blend-market APY applied over the vault's lifetime so far.
 */
export async function depositToVault(vaultId: string, contributionUsdc: string) {
  const vault = await getVaultById(vaultId);
  const newPrincipal = (
    Number.parseFloat(vault.principalUsdc) + Number.parseFloat(contributionUsdc)
  ).toFixed(2);

  const ageDays = Math.max(
    1,
    Math.round((Date.now() - new Date(vault.createdAt).getTime()) / 86_400_000),
  );
  const { yieldUsdc } = projectYield(newPrincipal, Number.parseFloat(vault.apyPercent), ageDays);

  const rows = await db
    .update(vaultPool)
    .set({ principalUsdc: newPrincipal, accruedYieldUsdc: yieldUsdc, updatedAt: new Date() })
    .where(eq(vaultPool.id, vaultId))
    .returning();
  return rows[0]!;
}

/** Reduce vault after a grant disbursement: yield is spent first, then principal. */
export async function withdrawFromVault(vaultId: string, amountUsdc: string) {
  const vault = await getVaultById(vaultId);
  const amount = Number.parseFloat(amountUsdc);
  const yieldBal = Number.parseFloat(vault.accruedYieldUsdc);
  const principalBal = Number.parseFloat(vault.principalUsdc);

  let newYield: number;
  let newPrincipal: number;
  if (amount <= yieldBal) {
    newYield = yieldBal - amount;
    newPrincipal = principalBal;
  } else {
    newYield = 0;
    const amountFromPrincipal = amount - yieldBal;
    newPrincipal = Math.max(0, principalBal - amountFromPrincipal);
  }

  const rows = await db
    .update(vaultPool)
    .set({
      principalUsdc: newPrincipal.toFixed(2),
      accruedYieldUsdc: newYield.toFixed(4),
      updatedAt: new Date(),
    })
    .where(eq(vaultPool.id, vaultId))
    .returning();
  return rows[0]!;
}

/** Aggregate live stats for the impact thermometer + pool growth panel. */
export async function getVaultStats() {
  const vault = await getVault();

  const allRoundUps = await db
    .select({ contribution: roundUps.contributionUsdc })
    .from(roundUps)
    .where(eq(roundUps.vaultId, vault.id));

  const allContributors = await db.select().from(contributors);
  const proposals = await db
    .select()
    .from(grantProposals)
    .where(eq(grantProposals.vaultId, vault.id));

  const totalRoundUps = allRoundUps.length;
  const principal = Number.parseFloat(vault.principalUsdc);
  const yieldUsdc = Number.parseFloat(vault.accruedYieldUsdc);
  const poolTotal = principal + yieldUsdc;

  const disbursed = proposals.filter((p) => p.status === 'disbursed');
  const grantedUsdc = disbursed.reduce((acc, p) => acc + Number.parseFloat(p.requestedUsdc), 0);

  return {
    vaultId: vault.id,
    vaultName: vault.name,
    vaultAddress: vault.vaultAddress,
    vaultContractId: vault.vaultContractId,
    apyPercent: vault.apyPercent,
    principalUsdc: principal.toFixed(2),
    accruedYieldUsdc: yieldUsdc.toFixed(4),
    poolTotalUsdc: poolTotal.toFixed(2),
    totalRoundUps,
    contributorCount: allContributors.length,
    merchantCount: allContributors.filter((c) => c.role === 'merchant').length,
    shopperCount: allContributors.filter((c) => c.role === 'shopper').length,
    proposalCount: proposals.length,
    grantsDisbursed: disbursed.length,
    grantedUsdc: grantedUsdc.toFixed(2),
  };
}
