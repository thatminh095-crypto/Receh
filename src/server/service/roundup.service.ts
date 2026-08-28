import { Asset } from '@stellar/stellar-sdk';
import { desc, eq, sql } from 'drizzle-orm';
import { stellar } from '@/server/config/stellar';
import { db } from '@/server/db/client';
import { contributors, type NewContributor, roundUps } from '@/server/db/schema';
import { AppError } from '@/server/lib/http';
import { buildSep7PayUri, createMuxedAddress } from '@/server/lib/muxed';
import { buildRecordRoundupXdr } from '@/server/lib/recehPoolContract';
import { roundedTotal, roundUpDelta } from '@/server/lib/roundup';
import {
  buildNativeXlmPayment,
  buildXlmStrictSendPayment,
  buildXlmToUsdcPayment,
  quoteXlmSendPath,
  verifyNativeXlmPaymentOnChain,
  verifyXlmPurchaseOnChain,
  verifyXlmRoundUpOnChain,
} from '@/server/lib/xlmPayment';
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
 * Persist a verified round-up: insert the row, bump contributor totals, deposit the
 * spare change into the shared vault, and attempt the on-chain contract record.
 * Shared by both payment paths once each has independently confirmed the funds
 * actually landed — this function itself does not re-verify anything.
 */
type SettleQuote = {
  vault: Awaited<ReturnType<typeof getVault>>;
  muxedAddress: string;
  contributor: Awaited<ReturnType<typeof getContributor>>;
};

async function settleRoundUp(params: {
  contributorId: string;
  purchaseUsdc: string;
  contributionUsdc: string;
  quote: SettleQuote;
  txHash: string;
}) {
  const { contributorId, purchaseUsdc, contributionUsdc, quote, txHash } = params;

  const rows = await db
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
  const roundUp = rows[0]!;

  const newTotal = (
    Number.parseFloat(quote.contributor.totalContributedUsdc) + Number.parseFloat(contributionUsdc)
  ).toFixed(2);
  await db
    .update(contributors)
    .set({
      totalContributedUsdc: newTotal,
      roundUpCount: quote.contributor.roundUpCount + 1,
    })
    .where(eq(contributors.id, contributorId));

  // Deposit spare change into the shared DeFindex vault (grows principal + yield).
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
 * Record a round-up paid directly in USDC: persist the contribution, attribute it to
 * the contributor (muxed), deposit the spare change into the shared vault, and bump
 * the contributor totals.
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

  return settleRoundUp({
    contributorId,
    purchaseUsdc,
    contributionUsdc: quote.contribution,
    quote,
    txHash,
  });
}

/**
 * Build an unsigned PathPaymentStrictReceive: the contributor pays in XLM, the vault
 * is guaranteed to receive exactly the USDC round-up amount if the transaction
 * succeeds at all (no slippage on the vault's side — only the payer's XLM cost varies,
 * capped by the slippage tolerance).
 */
export async function buildXlmRoundUpPayment(
  contributorPublicKey: string,
  contributorId: string,
  purchaseUsdc: string,
  increment = 1,
) {
  const quote = await quoteRoundUp(contributorId, purchaseUsdc, increment);
  if (Number.parseFloat(quote.contribution) <= 0) {
    throw new AppError(
      'INVALID_INPUT',
      'Purchase is already a whole amount — no spare change',
      400,
    );
  }
  const usdcAsset = new Asset(stellar.usdcAssetCode, stellar.usdcIssuer);
  const payment = await buildXlmToUsdcPayment({
    sourcePublicKey: contributorPublicKey,
    destination: quote.muxedAddress,
    destAsset: usdcAsset,
    destAmount: quote.contribution,
  });
  return { ...payment, quote };
}

/**
 * Record a round-up paid in XLM. Unlike the direct-USDC path, this never trusts the
 * client's claimed amount — it independently confirms on Horizon that the vault
 * actually received at least the round-up's USDC contribution before crediting
 * anything.
 */
export async function recordXlmRoundUp(params: {
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

  const verification = await verifyXlmRoundUpOnChain({
    txHash,
    destination: quote.muxedAddress,
    destAssetCode: stellar.usdcAssetCode,
    destAssetIssuer: stellar.usdcIssuer,
    minDestAmount: quote.contribution,
  });
  if (!verification.verified) {
    throw new AppError(
      'UNAUTHORIZED',
      verification.reason ?? 'Could not verify the XLM payment on-chain',
      401,
    );
  }

  return settleRoundUp({
    contributorId,
    purchaseUsdc,
    contributionUsdc: verification.actualDestAmount ?? quote.contribution,
    quote,
    txHash,
  });
}

/**
 * Quote + build an unsigned PathPaymentStrictSend for a purchase entered directly in
 * XLM: the spare change (round-up delta, in XLM) is what actually gets sent — the
 * USDC the vault receives depends on the live price and is read back off the chain
 * afterwards, never assumed here.
 */
export async function buildXlmPurchaseRoundUp(
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

  let muxedAddress = vault.vaultAddress;
  try {
    muxedAddress = createMuxedAddress(vault.vaultAddress, BigInt(contributor.muxIndex));
  } catch {
    muxedAddress = vault.vaultAddress;
  }

  const usdcAsset = new Asset(stellar.usdcAssetCode, stellar.usdcIssuer);
  const payment = await buildXlmStrictSendPayment({
    sourcePublicKey: contributorPublicKey,
    destination: muxedAddress,
    destAsset: usdcAsset,
    sendAmount: contributionXlm,
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
 * Record a round-up whose purchase was entered in XLM. The USDC credited to the vault
 * is always the REAL amount confirmed on-chain (path_payment_strict_send has no fixed
 * destination amount) — never a client-reported figure.
 */
export async function recordXlmPurchaseRoundUp(params: {
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

  let muxedAddress = vault.vaultAddress;
  try {
    muxedAddress = createMuxedAddress(vault.vaultAddress, BigInt(contributor.muxIndex));
  } catch {
    muxedAddress = vault.vaultAddress;
  }

  const usdcAsset = new Asset(stellar.usdcAssetCode, stellar.usdcIssuer);
  // A fresh floor quote just to sanity-bound what counts as an acceptable minimum —
  // the actual credited amount always comes from the verified on-chain result below,
  // this only guards against crediting a wildly-too-small or stale/zero transaction.
  const freshQuote = await quoteXlmSendPath(usdcAsset, contributionXlm);
  const minAcceptable = (Number.parseFloat(freshQuote.destAmount) * 0.9).toFixed(7);

  const verification = await verifyXlmPurchaseOnChain({
    txHash,
    destination: muxedAddress,
    destAssetCode: stellar.usdcAssetCode,
    destAssetIssuer: stellar.usdcIssuer,
    minDestAmount: minAcceptable,
  });
  if (!verification.verified || !verification.actualDestAmount) {
    throw new AppError(
      'UNAUTHORIZED',
      verification.reason ?? 'Could not verify the XLM payment on-chain',
      401,
    );
  }
  const contributionUsdc = verification.actualDestAmount;

  // Best-effort USDC-equivalent of the whole purchase for record-keeping/display only;
  // unlike contributionUsdc, this is never used to credit anything.
  const purchaseQuote = await quoteXlmSendPath(usdcAsset, purchaseXlm).catch(() => null);
  const purchaseUsdc = purchaseQuote?.destAmount ?? contributionUsdc;

  return settleRoundUp({
    contributorId,
    purchaseUsdc,
    contributionUsdc,
    quote: { vault, muxedAddress, contributor },
    txHash,
  });
}

/**
 * Build an unsigned plain Payment sending the XLM spare change straight to the vault —
 * no USDC conversion, no destination trustline required. For a vault that holds XLM
 * natively instead of routing everything into a USDC yield pool.
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

  let muxedAddress = vault.vaultAddress;
  try {
    muxedAddress = createMuxedAddress(vault.vaultAddress, BigInt(contributor.muxIndex));
  } catch {
    muxedAddress = vault.vaultAddress;
  }

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
 * never a client-reported figure.
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

  let muxedAddress = vault.vaultAddress;
  try {
    muxedAddress = createMuxedAddress(vault.vaultAddress, BigInt(contributor.muxIndex));
  } catch {
    muxedAddress = vault.vaultAddress;
  }

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
