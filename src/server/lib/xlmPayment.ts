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

/**
 * Build an unsigned plain Payment sending native XLM straight to `destination` — no
 * asset conversion, no destination trustline required at all (native XLM never needs
 * one). The vault holds XLM directly; there is no USDC conversion step anywhere in
 * this app.
 */
export async function buildNativeXlmPayment(params: {
  sourcePublicKey: string;
  destination: string;
  amount: string;
}): Promise<{ xdr: string }> {
  const { sourcePublicKey, destination, amount } = params;
  if (!sourcePublicKey.startsWith('G') || sourcePublicKey.length !== 56) {
    throw new AppError('INVALID_PUBLIC_KEY', 'Invalid Stellar public key', 400);
  }
  if (Number.parseFloat(amount) <= 0) {
    throw new AppError('INVALID_INPUT', 'amount must be positive', 400);
  }

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
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount }))
    .setTimeout(120)
    .build();

  return { xdr: tx.toXDR() };
}

/**
 * Verify a submitted native-XLM round-up actually happened on-chain: the transaction
 * is successful and contains a plain `payment` operation of native XLM for at least
 * `minAmount` to `destination`. Never trust a client-reported amount.
 */
export async function verifyNativeXlmPaymentOnChain(params: {
  txHash: string;
  destination: string;
  minAmount: string;
}): Promise<{ verified: boolean; actualAmount?: string; reason?: string }> {
  const { txHash, destination, minAmount } = params;
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
      o.type === 'payment' &&
      ((o as { to?: string }).to === destination ||
        (o as { to_muxed?: string }).to_muxed === destination),
  ) as
    | undefined
    | {
        to: string;
        to_muxed?: string;
        asset_type: string;
        amount: string;
      };

  if (!op) {
    return {
      verified: false,
      reason: 'No matching payment to the vault found in this transaction',
    };
  }
  if (op.asset_type !== 'native') {
    return { verified: false, reason: 'Payment landed in the wrong asset' };
  }
  if (Number.parseFloat(op.amount) < Number.parseFloat(minAmount)) {
    return {
      verified: false,
      reason: `Amount received (${op.amount}) is less than required (${minAmount})`,
    };
  }
  return { verified: true, actualAmount: op.amount };
}
