import { desc, eq } from 'drizzle-orm';
import { stellar } from '@/server/config/stellar';
import { db } from '@/server/db/client';
import { contributors, type NewContributor, roundUps } from '@/server/db/schema';
import { AppError } from '@/server/lib/http';
import { buildSep7PayUri, createMuxedAddress } from '@/server/lib/muxed';
import { roundedTotal, roundUpDelta } from '@/server/lib/roundup';
import { depositToVault, getVault } from './vault.service';

export async function listContributors() {
  return db.select().from(contributors).orderBy(desc(contributors.totalContributedUsdc));
}

export async function getContributor(id: string) {
  const rows = await db.select().from(contributors).where(eq(contributors.id, id));
  if (!rows[0]) throw new AppError('NOT_FOUND', 'Contributor not found', 404);
  return rows[0];
}

export async function createContributor(data: Omit<NewContributor, 'muxIndex'>) {
  const existing = await db.select({ muxIndex: contributors.muxIndex }).from(contributors);
  const nextIndex = existing.reduce((max, c) => Math.max(max, c.muxIndex), 0) + 1;
  const rows = await db
    .insert(contributors)
    .values({ ...data, muxIndex: nextIndex })
    .returning();
  return rows[0]!;
}

/** Compute the SEP-7 round-up routing URI for a contributor + purchase (preview, no write). */
export async function quoteRoundUp(contributorId: string, purchaseUsdc: string, increment = 1) {
  const contributor = await getContributor(contributorId);
  const vault = await getVault();

  const contribution = roundUpDelta(purchaseUsdc, increment);
  const total = roundedTotal(purchaseUsdc, increment);

  // Per-contributor SEP-23 muxed attribution on the shared vault account.
  let muxedAddress = vault.vaultAddress;
  try {
    muxedAddress = createMuxedAddress(vault.vaultAddress, BigInt(contributor.muxIndex));
  } catch {
    muxedAddress = vault.vaultAddress;
  }

  const sep7Uri = buildSep7PayUri({
    destination: muxedAddress,
    amount: contribution,
    assetCode: stellar.usdcAssetCode,
    assetIssuer: stellar.usdcIssuer,
    memo: `RECEH:${contributor.id.slice(0, 8)}`,
    memoType: 'text',
    msg: 'Receh round-up into community vault',
  });

  return { contributor, vault, contribution, total, purchaseUsdc, muxedAddress, sep7Uri };
}

/**
 * Record a round-up: persist the contribution, attribute it to the contributor (muxed),
 * deposit the spare change into the shared vault, and bump the contributor totals.
 */
export async function recordRoundUp(params: {
  contributorId: string;
  purchaseUsdc: string;
  increment?: number;
  txHash?: string;
}) {
  const { contributorId, purchaseUsdc, increment = 1, txHash = '' } = params;
  const quote = await quoteRoundUp(contributorId, purchaseUsdc, increment);

  if (Number.parseFloat(quote.contribution) <= 0) {
    throw new AppError(
      'INVALID_INPUT',
      'Purchase is already a whole amount — no spare change',
      400,
    );
  }

  const rows = await db
    .insert(roundUps)
    .values({
      contributorId,
      vaultId: quote.vault.id,
      purchaseUsdc,
      contributionUsdc: quote.contribution,
      muxedAddress: quote.muxedAddress,
      txHash: txHash || `rndup${Math.random().toString(16).slice(2, 14)}`,
    })
    .returning();
  const roundUp = rows[0]!;

  // Bump contributor totals.
  const newTotal = (
    Number.parseFloat(quote.contributor.totalContributedUsdc) +
    Number.parseFloat(quote.contribution)
  ).toFixed(2);
  await db
    .update(contributors)
    .set({
      totalContributedUsdc: newTotal,
      roundUpCount: quote.contributor.roundUpCount + 1,
    })
    .where(eq(contributors.id, contributorId));

  // Deposit spare change into the shared DeFindex vault (grows principal + yield).
  const vault = await depositToVault(quote.vault.id, quote.contribution);

  return { roundUp, vault, contribution: quote.contribution };
}

export async function listRoundUps(limit = 20) {
  return db.select().from(roundUps).orderBy(desc(roundUps.createdAt)).limit(limit);
}
