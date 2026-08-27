// @vitest-environment node
import { Account, Asset } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const strictReceivePathsCall = vi.fn();
const strictSendPathsCall = vi.fn();
const loadAccount = vi.fn();
const transactionCall = vi.fn();
const operationsCall = vi.fn();
const submitTransaction = vi.fn();

vi.mock('@/server/config/stellar', () => ({
  stellar: {
    passphrase: 'Test SDF Network ; September 2015',
    usdcAssetCode: 'USDC',
    usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    server: {
      strictReceivePaths: () => ({ call: strictReceivePathsCall }),
      strictSendPaths: () => ({ call: strictSendPathsCall }),
      loadAccount: (pk: string) => loadAccount(pk),
      transactions: () => ({ transaction: (id: string) => ({ call: () => transactionCall(id) }) }),
      operations: () => ({ forTransaction: (id: string) => ({ call: () => operationsCall(id) }) }),
      submitTransaction: (tx: unknown) => submitTransaction(tx),
    },
  },
}));

const {
  quoteXlmToDestPath,
  buildXlmToUsdcPayment,
  verifyXlmRoundUpOnChain,
  submitSignedXlmPayment,
  quoteXlmSendPath,
  buildXlmStrictSendPayment,
  verifyXlmPurchaseOnChain,
} = await import('@/server/lib/xlmPayment');

const VAULT = 'GBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIE47';
const PAYER = 'GAEIMHCAB46FUYMWWVXAHSMOBK7VF7PKGX2OIBOG44K5FGL4T7NJPRC3';
const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');

beforeEach(() => {
  strictReceivePathsCall.mockReset();
  strictSendPathsCall.mockReset();
  loadAccount.mockReset();
  transactionCall.mockReset();
  operationsCall.mockReset();
  submitTransaction.mockReset();
});

describe('quoteXlmToDestPath', () => {
  it('maps the best Horizon path record', async () => {
    strictReceivePathsCall.mockResolvedValueOnce({
      records: [{ path: [], source_amount: '12.3456789' }],
    });
    const quote = await quoteXlmToDestPath(USDC, '1.00');
    expect(quote.sourceAmount).toBe('12.3456789');
    expect(quote.path).toEqual([]);
  });

  it('throws CONFLICT when no path has liquidity', async () => {
    strictReceivePathsCall.mockResolvedValueOnce({ records: [] });
    await expect(quoteXlmToDestPath(USDC, '1.00')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('buildXlmToUsdcPayment', () => {
  it('builds a PathPaymentStrictReceive with a slippage-padded sendMax', async () => {
    strictReceivePathsCall.mockResolvedValueOnce({
      records: [{ path: [], source_amount: '10.0000000' }],
    });
    loadAccount.mockResolvedValueOnce(new Account(PAYER, '100'));

    const result = await buildXlmToUsdcPayment({
      sourcePublicKey: PAYER,
      destination: VAULT,
      destAsset: USDC,
      destAmount: '1.00',
    });

    expect(result.expectedSourceAmount).toBe('10.0000000');
    // Default 150bps slippage: 10 * 1.015 = 10.15
    expect(result.sendMax).toBe('10.1500000');
    expect(result.xdr).toContain('AAAA'); // real base64 XDR, not empty
  });

  it('rejects a non-positive destAmount without calling Horizon', async () => {
    await expect(
      buildXlmToUsdcPayment({
        sourcePublicKey: PAYER,
        destination: VAULT,
        destAsset: USDC,
        destAmount: '0',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(strictReceivePathsCall).not.toHaveBeenCalled();
  });
});

describe('verifyXlmRoundUpOnChain', () => {
  // The vault's muxed attribution address, as passed to quoteRoundUp/build-xlm.
  const MUXED_DEST = 'MBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIAAAAAAAAAAAARGXI';
  const okParams = {
    txHash: 'a'.repeat(64),
    destination: MUXED_DEST,
    destAssetCode: 'USDC',
    destAssetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    minDestAmount: '0.70',
  };

  it('verifies a successful matching path_payment_strict_receive to a muxed destination', async () => {
    // Horizon resolves a muxed destination's `to` to the base G-address and reports
    // the muxed address separately in `to_muxed` — this is the real response shape.
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'path_payment_strict_receive',
          to: VAULT,
          to_muxed: MUXED_DEST,
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          amount: '0.70',
        },
      ],
    });
    const result = await verifyXlmRoundUpOnChain(okParams);
    expect(result).toEqual({ verified: true, actualDestAmount: '0.70' });
  });

  it('rejects when the transaction is not found', async () => {
    transactionCall.mockRejectedValueOnce(new Error('404'));
    const result = await verifyXlmRoundUpOnChain(okParams);
    expect(result.verified).toBe(false);
  });

  it('rejects an unsuccessful transaction', async () => {
    transactionCall.mockResolvedValueOnce({ successful: false });
    const result = await verifyXlmRoundUpOnChain(okParams);
    expect(result).toMatchObject({
      verified: false,
      reason: expect.stringContaining('not successful'),
    });
  });

  it('rejects when no operation pays the vault destination', async () => {
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({ records: [] });
    const result = await verifyXlmRoundUpOnChain(okParams);
    expect(result.verified).toBe(false);
  });

  it('rejects when the received asset does not match', async () => {
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'path_payment_strict_receive',
          to: VAULT,
          to_muxed: MUXED_DEST,
          asset_type: 'native',
          amount: '5.00',
        },
      ],
    });
    const result = await verifyXlmRoundUpOnChain(okParams);
    expect(result).toMatchObject({
      verified: false,
      reason: expect.stringContaining('wrong asset'),
    });
  });

  it('rejects when the received amount is below the minimum', async () => {
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'path_payment_strict_receive',
          to: VAULT,
          to_muxed: MUXED_DEST,
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          amount: '0.10',
        },
      ],
    });
    const result = await verifyXlmRoundUpOnChain(okParams);
    expect(result).toMatchObject({
      verified: false,
      reason: expect.stringContaining('less than required'),
    });
  });
});

describe('submitSignedXlmPayment', () => {
  it('rejects malformed XDR before touching Horizon', async () => {
    await expect(submitSignedXlmPayment('not-a-real-xdr')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it('wraps a Horizon submission failure as CONFLICT', async () => {
    const account = new Account(PAYER, '100');
    strictReceivePathsCall.mockResolvedValueOnce({ records: [{ path: [], source_amount: '10' }] });
    loadAccount.mockResolvedValueOnce(account);
    const built = await buildXlmToUsdcPayment({
      sourcePublicKey: PAYER,
      destination: VAULT,
      destAsset: USDC,
      destAmount: '1.00',
    });
    submitTransaction.mockRejectedValueOnce(new Error('tx_failed'));
    await expect(submitSignedXlmPayment(built.xdr)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('quoteXlmSendPath', () => {
  it('maps the best Horizon strict-send path record', async () => {
    strictSendPathsCall.mockResolvedValueOnce({
      records: [{ path: [], destination_amount: '0.8750030' }],
    });
    const quote = await quoteXlmSendPath(USDC, '0.5000000');
    expect(quote.destAmount).toBe('0.8750030');
    expect(quote.path).toEqual([]);
  });

  it('throws CONFLICT when no path has liquidity', async () => {
    strictSendPathsCall.mockResolvedValueOnce({ records: [] });
    await expect(quoteXlmSendPath(USDC, '0.5')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('buildXlmStrictSendPayment', () => {
  it('builds a PathPaymentStrictSend with a slippage-padded destMin', async () => {
    strictSendPathsCall.mockResolvedValueOnce({
      records: [{ path: [], destination_amount: '1.0000000' }],
    });
    loadAccount.mockResolvedValueOnce(new Account(PAYER, '100'));

    const result = await buildXlmStrictSendPayment({
      sourcePublicKey: PAYER,
      destination: VAULT,
      destAsset: USDC,
      sendAmount: '0.5000000',
    });

    expect(result.expectedDestAmount).toBe('1.0000000');
    // Default 150bps slippage floor: 1.00 * 0.985 = 0.985
    expect(result.destMin).toBe('0.9850000');
    expect(result.xdr).toContain('AAAA');
  });

  it('rejects a non-positive sendAmount without calling Horizon', async () => {
    await expect(
      buildXlmStrictSendPayment({
        sourcePublicKey: PAYER,
        destination: VAULT,
        destAsset: USDC,
        sendAmount: '0',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(strictSendPathsCall).not.toHaveBeenCalled();
  });
});

describe('verifyXlmPurchaseOnChain', () => {
  const MUXED_DEST = 'MBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIAAAAAAAAAAAARGXI';
  const okParams = {
    txHash: 'b'.repeat(64),
    destination: MUXED_DEST,
    destAssetCode: 'USDC',
    destAssetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    minDestAmount: '0.80',
  };

  it('verifies a successful matching path_payment_strict_send and returns the real amount', async () => {
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'path_payment_strict_send',
          to: VAULT,
          to_muxed: MUXED_DEST,
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          amount: '0.8750030',
        },
      ],
    });
    const result = await verifyXlmPurchaseOnChain(okParams);
    expect(result).toEqual({ verified: true, actualDestAmount: '0.8750030' });
  });

  it('rejects when the settled amount is below the floor', async () => {
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'path_payment_strict_send',
          to: VAULT,
          to_muxed: MUXED_DEST,
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          amount: '0.10',
        },
      ],
    });
    const result = await verifyXlmPurchaseOnChain(okParams);
    expect(result).toMatchObject({
      verified: false,
      reason: expect.stringContaining('less than required'),
    });
  });

  it('rejects when no strict-send operation matches the vault destination', async () => {
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({ records: [] });
    const result = await verifyXlmPurchaseOnChain(okParams);
    expect(result.verified).toBe(false);
  });
});
