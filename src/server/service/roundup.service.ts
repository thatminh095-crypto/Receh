import { desc, eq, sql } from 'drizzle-orm';
import { stellar } from '@/server/config/stellar';
import { db } from '@/server/db/client';
import { contributors, type NewContributor, roundUps } from '@/server/db/schema';
import { AppError } from '@/server/lib/http';
import { buildSep7PayUri, createMuxedAddress } from '@/server/lib/muxed';
import { buildRecordRoundupXdr } from '@/server/lib/recehPoolContract';
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
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${contributors} IN SHARE ROW EXCLUSIVE MODE`);
    const rows = await tx
      .select({ max: sql<number>`COALESCE(MAX(${contributors.muxIndex}), 0)` })
      .from(contributors);
    const nextIndex = Number(rows[0]?.max ?? 0) + 1;
    return tx
      .insert(contributors)
      .values({ ...data, muxIndex: nextIndex })
      .returning();
  });
  return inserted[0]!;
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
 *
 * Requires a real on-chain txHash from the SEP-7 payment; reject if missing.
 */
export async function recordRoundUp(params: {
  contributorId: string;
  purchaseUsdc: string;
  increment?: number;
  txHash: string;
}) {
  const { contributorId, purchaseUsdc, increment = 1, txHash } = params;
  if (!txHash || !/^[a-f0-9]{64}$/i.test(txHash)) {
    throw new AppError(
      'INVALID_INPUT',
      'A real Horizon txHash (64-char hex) is required to record a round-up',
      400,
    );
  }
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
      txHash,
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

  const contractAttempt = await recordRoundUpOnChain({
    contributor: quote.contributor,
    muxedAddress: quote.muxedAddress,
    contributionUsdc: quote.contribution,
    txHash,
  });

  return { roundUp, vault, contribution: quote.contribution, contractAttempt };
}

export async function listRoundUps(limit = 20) {
  return db.select().from(roundUps).orderBy(desc(roundUps.createdAt)).limit(limit);
}

async function recordRoundUpOnChain(params: {
  contributor: Awaited<ReturnType<typeof getContributor>>;
  muxedAddress: string;
  contributionUsdc: string;
  txHash: string;
}): Promise<{ invoked: boolean; xdr?: string; reason: string }> {
  const { contributor, muxedAddress, contributionUsdc, txHash } = params;
  const contributorAddress = contributor.stellarAddress;
  if (!contributorAddress) {
    console.warn(
      `[recordRoundUpOnChain] contributor ${contributor.id} has no stellarAddress — contract.record_roundup not invoked`,
    );
    return { invoked: false, reason: 'contributor has no stellarAddress' };
  }

  try {
    const stroops = BigInt(
      Math.round(Number.parseFloat(contributionUsdc) * 10_000_000),
    ).toString();
    const prepared = await buildRecordRoundupXdr({
      contributor: contributorAddress,
      muxedId: String(contributor.muxIndex),
      amountStroops: stroops,
    });
    console.info(
      `[recordRoundUpOnChain] built contract.record_roundup XDR for ${contributorAddress} ` +
        `mux=${contributor.muxIndex} amount=${stroops} horizonTx=${txHash} muxedAddress=${muxedAddress}`,
    );
    return { invoked: true, xdr: prepared.xdr, reason: 'xdr-ready-for-freighter' };
  } catch (err) {
    console.error('[recordRoundUpOnChain] contract.record_roundup prep failed', err);
    return { invoked: false, reason: (err as Error).message ?? 'prep failed' };
  }
}
