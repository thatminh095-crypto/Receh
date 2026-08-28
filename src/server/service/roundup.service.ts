import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { contributors, type NewContributor, roundUps } from '@/server/db/schema';
import { AppError } from '@/server/lib/http';
import { createMuxedAddress } from '@/server/lib/muxed';
import { buildRecordRoundupXdr } from '@/server/lib/recehPoolContract';
import { roundedTotal, roundUpDelta } from '@/server/lib/roundup';
import { buildNativeXlmPayment, verifyNativeXlmPaymentOnChain } from '@/server/lib/xlmPayment';
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

type SettleQuote = {
  vault: Awaited<ReturnType<typeof getVault>>;
  muxedAddress: string;
  contributor: Awaited<ReturnType<typeof getContributor>>;
};

/**
 * Persist a verified round-up: insert the row (txHash unique per vault — a replayed
 * hash is rejected, never double-credited), bump contributor totals atomically in SQL
 * (not read-then-write in JS, so two concurrent round-ups from the same contributor
 * can't race and lose an update), deposit into the shared vault, and attempt the
 * on-chain contract record. Shared by every settlement path once it has independently
 * confirmed the funds actually landed — this function itself does not re-verify
 * anything.
 */
async function settleRoundUp(params: {
  contributorId: string;
  purchaseUsdc: string;
  contributionUsdc: string;
  quote: SettleQuote;
  txHash: string;
}) {
  const { contributorId, purchaseUsdc, contributionUsdc, quote, txHash } = params;

  let rows: (typeof roundUps.$inferSelect)[];
  try {
    rows = await db
      .insert(roundUps)
      .values({
        contributorId,
        vaultId: quote.vault.id,
        purchaseUsdc,
        contributionUsdc,
        muxedAddress: quote.muxedAddress,
        txHash,
      })
      .returning();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('round_ups_tx_hash_unique')) {
      throw new AppError('CONFLICT', 'This transaction was already recorded', 409);
    }
    throw err;
  }
  const roundUp = rows[0]!;

  await db
    .update(contributors)
    .set({
      totalContributedUsdc: sql`(${contributors.totalContributedUsdc}::numeric + ${contributionUsdc}::numeric)::text`,
      roundUpCount: sql`${contributors.roundUpCount} + 1`,
    })
    .where(eq(contributors.id, contributorId));

  // Deposit spare change into the shared vault.
  const vault = await depositToVault(quote.vault.id, contributionUsdc);

  const contractAttempt = await recordRoundUpOnChain({
    contributor: quote.contributor,
    muxedAddress: quote.muxedAddress,
    contributionUsdc,
    txHash,
  });

  return { roundUp, vault, contribution: contributionUsdc, contractAttempt };
}

/**
 * Build an unsigned plain Payment sending the XLM spare change straight to the vault —
 * no USDC conversion, no destination trustline required. The vault holds XLM directly.
 */
export async function buildNativeXlmRoundUp(
  contributorPublicKey: string,
  contributorId: string,
  purchaseXlm: string,
  increment = 1,
) {
  const contributor = await getContributor(contributorId);
  const vault = await getVault();
  const contributionXlm = roundUpDelta(purchaseXlm, increment, 7);
  if (Number.parseFloat(contributionXlm) <= 0) {
    throw new AppError(
      'INVALID_INPUT',
      'Purchase is already a whole XLM amount — no spare change',
      400,
    );
  }

  // Fail closed: never send a round-up to the shared base address just because a
  // contributor's muxed encoding failed — that would let one contributor's payment
  // be recorded under a different contributor's identity (every muxed payment
  // resolves back to the same base G-address on Horizon).
  const muxedAddress = createMuxedAddress(vault.vaultAddress, BigInt(contributor.muxIndex));

  const payment = await buildNativeXlmPayment({
    sourcePublicKey: contributorPublicKey,
    destination: muxedAddress,
    amount: contributionXlm,
  });

  return {
    ...payment,
    contributionXlm,
    roundedTotalXlm: roundedTotal(purchaseXlm, increment, 7),
    purchaseXlm,
    muxedAddress,
    contributor,
    vault,
  };
}

/**
 * Record a native-XLM round-up. Always credits the REAL amount confirmed on Horizon —
 * never a client-reported figure. A replayed txHash is rejected by the database's
 * unique constraint in settleRoundUp, not just re-verified and re-credited.
 */
export async function recordNativeXlmRoundUp(params: {
  contributorId: string;
  purchaseXlm: string;
  increment?: number;
  txHash: string;
}) {
  const { contributorId, purchaseXlm, increment = 1, txHash } = params;
  if (!txHash || !/^[a-f0-9]{64}$/i.test(txHash)) {
    throw new AppError(
      'INVALID_INPUT',
      'A real Horizon txHash (64-char hex) is required to record a round-up',
      400,
    );
  }
  const contributor = await getContributor(contributorId);
  const vault = await getVault();
  const contributionXlm = roundUpDelta(purchaseXlm, increment, 7);
  if (Number.parseFloat(contributionXlm) <= 0) {
    throw new AppError(
      'INVALID_INPUT',
      'Purchase is already a whole XLM amount — no spare change',
      400,
    );
  }

  const muxedAddress = createMuxedAddress(vault.vaultAddress, BigInt(contributor.muxIndex));

  const verification = await verifyNativeXlmPaymentOnChain({
    txHash,
    destination: muxedAddress,
    minAmount: contributionXlm,
  });
  if (!verification.verified || !verification.actualAmount) {
    throw new AppError(
      'UNAUTHORIZED',
      verification.reason ?? 'Could not verify the XLM payment on-chain',
      401,
    );
  }

  return settleRoundUp({
    contributorId,
    purchaseUsdc: purchaseXlm,
    contributionUsdc: verification.actualAmount,
    quote: { vault, muxedAddress, contributor },
    txHash,
  });
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
    const stroops = BigInt(Math.round(Number.parseFloat(contributionUsdc) * 10_000_000)).toString();
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
