import { Asset, BASE_FEE, type Horizon, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { stellar } from '@/server/config/stellar';
import { AppError } from '@/server/lib/http';

/** Submit an already-Freighter-signed transaction XDR to Horizon and return its hash. */
export async function submitSignedXlmPayment(signedTxXdr: string): Promise<string> {
  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(signedTxXdr, stellar.passphrase);
  } catch {
    throw new AppError('INVALID_INPUT', 'Malformed signed transaction XDR', 400);
  }
  try {
    const result = await stellar.server.submitTransaction(tx);
    return result.hash;
  } catch (err) {
    const detail =
      err && typeof err === 'object' && 'response' in err
        ? JSON.stringify((err as { response?: { data?: unknown } }).response?.data)
        : err instanceof Error
          ? err.message
          : 'unknown error';
    throw new AppError('CONFLICT', `Horizon rejected the transaction: ${detail}`, 409);
  }
}

export type StrictReceiveQuote = {
  /** Best path found by Horizon for the requested destination amount. */
  path: Asset[];
  /** Source (XLM) amount required for this path, before the safety margin. */
  sourceAmount: string;
};

/**
 * Ask Horizon for the cheapest XLM -> destination-asset path that delivers exactly
 * `destAmount` of the destination asset. Throws if no path currently has enough
 * liquidity (thin XLM/USDC order book, or the vault of any intermediate asset is empty).
 */
export async function quoteXlmToDestPath(
  destAsset: Asset,
  destAmount: string,
): Promise<StrictReceiveQuote> {
  const page = await stellar.server
    .strictReceivePaths([Asset.native()], destAsset, destAmount)
    .call();
  const best = page.records[0];
  if (!best) {
    throw new AppError(
      'CONFLICT',
      'No XLM route to USDC has enough liquidity for this amount right now',
      409,
    );
  }
  return {
    path: best.path.map((p) =>
      p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!),
    ),
    sourceAmount: best.source_amount,
  };
}

/**
 * Build an unsigned PathPaymentStrictReceive transaction: the payer sends XLM, the
 * destination is GUARANTEED to receive exactly `destAmount` of `destAsset` if the
 * transaction succeeds at all — no slippage on the receiving side, so the vault's
 * USDC accounting never needs to trust a client-reported "amount received".
 *
 * `slippageBps` caps how much more XLM the payer allows the path to cost by the time
 * the transaction lands (basis points, e.g. 150 = 1.5%); the transaction simply fails
 * if the live price moves past that cap, it never silently overcharges.
 */
export async function buildXlmToUsdcPayment(params: {
  sourcePublicKey: string;
  destination: string;
  destAsset: Asset;
  destAmount: string;
  slippageBps?: number;
}): Promise<{ xdr: string; sendMax: string; expectedSourceAmount: string }> {
  const { sourcePublicKey, destination, destAsset, destAmount, slippageBps = 150 } = params;
  if (!sourcePublicKey.startsWith('G') || sourcePublicKey.length !== 56) {
    throw new AppError('INVALID_PUBLIC_KEY', 'Invalid Stellar public key', 400);
  }
  if (Number.parseFloat(destAmount) <= 0) {
    throw new AppError('INVALID_INPUT', 'destAmount must be positive', 400);
  }

  const quote = await quoteXlmToDestPath(destAsset, destAmount);
  const sendMax = (Number.parseFloat(quote.sourceAmount) * (1 + slippageBps / 10_000)).toFixed(7);

  let account: Awaited<ReturnType<typeof stellar.server.loadAccount>>;
  try {
    account = await stellar.server.loadAccount(sourcePublicKey);
  } catch (err) {
    throw new AppError(
      'NOT_FOUND',
      err instanceof Error ? `Could not load account: ${err.message}` : 'Could not load account',
      404,
    );
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellar.passphrase,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax,
        destination,
        destAsset,
        destAmount,
        path: quote.path,
      }),
    )
    .setTimeout(120)
    .build();

  return { xdr: tx.toXDR(), sendMax, expectedSourceAmount: quote.sourceAmount };
}

export type StrictSendQuote = {
  /** Best path found by Horizon for the requested source amount. */
  path: Asset[];
  /** Destination-asset amount this path is expected to deliver, before the safety floor. */
  destAmount: string;
};

/**
 * Ask Horizon how much of `destAsset` a fixed `sendAmount` of XLM is expected to buy
 * right now. Used when the payer picks the XLM amount directly (an XLM-denominated
 * purchase), rather than picking a target USDC amount.
 */
export async function quoteXlmSendPath(
  destAsset: Asset,
  sendAmount: string,
): Promise<StrictSendQuote> {
  const page = await stellar.server.strictSendPaths(Asset.native(), sendAmount, [destAsset]).call();
  const best = page.records[0];
  if (!best) {
    throw new AppError(
      'CONFLICT',
      'No XLM route to USDC has enough liquidity for this amount right now',
      409,
    );
  }
  return {
    path: best.path.map((p) =>
      p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!),
    ),
    destAmount: best.destination_amount,
  };
}

/**
 * Build an unsigned PathPaymentStrictSend transaction: the payer sends an EXACT amount
 * of XLM (the round-up spare change, computed in XLM terms), and the destination
 * receives whatever that's worth in `destAsset` at execution time — at least
 * `destMin`, a slippage floor derived from the live quote. Unlike strict-receive, the
 * amount the vault actually gets is NOT fixed in advance, so callers must read the
 * real settled amount back off the submitted transaction before crediting anything.
 */
export async function buildXlmStrictSendPayment(params: {
  sourcePublicKey: string;
  destination: string;
  destAsset: Asset;
  sendAmount: string;
  slippageBps?: number;
}): Promise<{ xdr: string; destMin: string; expectedDestAmount: string }> {
  const { sourcePublicKey, destination, destAsset, sendAmount, slippageBps = 150 } = params;
  if (!sourcePublicKey.startsWith('G') || sourcePublicKey.length !== 56) {
    throw new AppError('INVALID_PUBLIC_KEY', 'Invalid Stellar public key', 400);
  }
  if (Number.parseFloat(sendAmount) <= 0) {
    throw new AppError('INVALID_INPUT', 'sendAmount must be positive', 400);
  }

  const quote = await quoteXlmSendPath(destAsset, sendAmount);
  const destMin = (Number.parseFloat(quote.destAmount) * (1 - slippageBps / 10_000)).toFixed(7);

  let account: Awaited<ReturnType<typeof stellar.server.loadAccount>>;
  try {
    account = await stellar.server.loadAccount(sourcePublicKey);
  } catch (err) {
    throw new AppError(
      'NOT_FOUND',
      err instanceof Error ? `Could not load account: ${err.message}` : 'Could not load account',
      404,
    );
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellar.passphrase,
  })
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: Asset.native(),
        sendAmount,
        destination,
        destAsset,
        destMin,
        path: quote.path,
      }),
    )
    .setTimeout(120)
    .build();

  return { xdr: tx.toXDR(), destMin, expectedDestAmount: quote.destAmount };
}

/**
 * Verify a submitted XLM-denominated purchase actually happened on-chain: the
 * transaction is successful and contains a path_payment_strict_send operation that
 * delivered at least `minDestAmount` of `destAsset` to `destination`. Returns the
 * REAL settled amount — strict-send has no fixed destination amount, so this (not any
 * client-reported figure) is what gets credited.
 */
export async function verifyXlmPurchaseOnChain(params: {
  txHash: string;
  destination: string;
  destAssetCode: string;
  destAssetIssuer: string;
  minDestAmount: string;
}): Promise<{ verified: boolean; actualDestAmount?: string; reason?: string }> {
  const { txHash, destination, destAssetCode, destAssetIssuer, minDestAmount } = params;
  let tx: Horizon.ServerApi.TransactionRecord;
  try {
    tx = await stellar.server.transactions().transaction(txHash).call();
  } catch {
    return { verified: false, reason: 'Transaction not found on Horizon' };
  }
  if (!tx.successful) {
    return { verified: false, reason: 'Transaction was not successful' };
  }

  const opsPage = await stellar.server.operations().forTransaction(txHash).call();
  const op = opsPage.records.find(
    (o) =>
      o.type === 'path_payment_strict_send' &&
      ((o as { to?: string }).to === destination ||
        (o as { to_muxed?: string }).to_muxed === destination),
  ) as
    | undefined
    | {
        to: string;
        to_muxed?: string;
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
        amount: string;
      };

  if (!op) {
    return {
      verified: false,
      reason: 'No matching path_payment_strict_send to the vault found in this transaction',
    };
  }
  const isTargetAsset =
    op.asset_type !== 'native' &&
    op.asset_code === destAssetCode &&
    op.asset_issuer === destAssetIssuer;
  if (!isTargetAsset) {
    return { verified: false, reason: 'Payment landed in the wrong asset' };
  }
  if (Number.parseFloat(op.amount) < Number.parseFloat(minDestAmount)) {
    return {
      verified: false,
      reason: `Amount received (${op.amount}) is less than required (${minDestAmount})`,
    };
  }
  return { verified: true, actualDestAmount: op.amount };
}

/**
 * Verify a submitted XLM round-up actually happened on-chain: the transaction is
 * successful and contains a path_payment_strict_receive operation that delivered at
 * least `destAmount` of `destAsset` to `destination`. Never trust a client-reported
 * amount for money that's about to be credited.
 */
export async function verifyXlmRoundUpOnChain(params: {
  txHash: string;
  destination: string;
  destAssetCode: string;
  destAssetIssuer: string;
  minDestAmount: string;
}): Promise<{ verified: boolean; actualDestAmount?: string; reason?: string }> {
  const { txHash, destination, destAssetCode, destAssetIssuer, minDestAmount } = params;
  let tx: Horizon.ServerApi.TransactionRecord;
  try {
    tx = await stellar.server.transactions().transaction(txHash).call();
  } catch {
    return { verified: false, reason: 'Transaction not found on Horizon' };
  }
  if (!tx.successful) {
    return { verified: false, reason: 'Transaction was not successful' };
  }

  const opsPage = await stellar.server.operations().forTransaction(txHash).call();
  // Horizon resolves a muxed destination's `to` field down to the base G-address and
  // puts the muxed M-address in a separate `to_muxed` field — match on whichever the
  // caller passed (plain destination or muxed attribution address).
  const op = opsPage.records.find(
    (o) =>
      o.type === 'path_payment_strict_receive' &&
      ((o as { to?: string }).to === destination ||
        (o as { to_muxed?: string }).to_muxed === destination),
  ) as
    | undefined
    | {
        to: string;
        to_muxed?: string;
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
        amount: string;
      };

  if (!op) {
    return {
      verified: false,
      reason: 'No matching path_payment_strict_receive to the vault found in this transaction',
    };
  }
  const isTargetAsset =
    op.asset_type !== 'native' &&
    op.asset_code === destAssetCode &&
    op.asset_issuer === destAssetIssuer;
  if (!isTargetAsset) {
    return { verified: false, reason: 'Payment landed in the wrong asset' };
  }
  if (Number.parseFloat(op.amount) < Number.parseFloat(minDestAmount)) {
    return {
      verified: false,
      reason: `Amount received (${op.amount}) is less than required (${minDestAmount})`,
    };
  }
  return { verified: true, actualDestAmount: op.amount };
}
