// @vitest-environment node
import { Account } from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAccount = vi.fn();
const transactionCall = vi.fn();
const operationsCall = vi.fn();
const submitTransaction = vi.fn();

vi.mock('@/server/config/stellar', () => ({
  stellar: {
    passphrase: 'Test SDF Network ; September 2015',
    server: {
      loadAccount: (pk: string) => loadAccount(pk),
      transactions: () => ({ transaction: (id: string) => ({ call: () => transactionCall(id) }) }),
      operations: () => ({ forTransaction: (id: string) => ({ call: () => operationsCall(id) }) }),
      submitTransaction: (tx: unknown) => submitTransaction(tx),
    },
  },
}));

const { buildNativeXlmPayment, verifyNativeXlmPaymentOnChain, submitSignedXlmPayment } =
  await import('@/server/lib/xlmPayment');

const VAULT = 'GBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIE47';
const PAYER = 'GAEIMHCAB46FUYMWWVXAHSMOBK7VF7PKGX2OIBOG44K5FGL4T7NJPRC3';

beforeEach(() => {
  loadAccount.mockReset();
  transactionCall.mockReset();
  operationsCall.mockReset();
  submitTransaction.mockReset();
});

describe('buildNativeXlmPayment', () => {
  it('builds a plain native-XLM payment XDR', async () => {
    loadAccount.mockResolvedValueOnce(new Account(PAYER, '100'));
    const result = await buildNativeXlmPayment({
      sourcePublicKey: PAYER,
      destination: VAULT,
      amount: '0.7000000',
    });
    expect(result.xdr).toContain('AAAA');
  });

  it('rejects a non-positive amount without calling Horizon', async () => {
    await expect(
      buildNativeXlmPayment({ sourcePublicKey: PAYER, destination: VAULT, amount: '0' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(loadAccount).not.toHaveBeenCalled();
  });

  it('rejects an invalid source public key', async () => {
    await expect(
      buildNativeXlmPayment({ sourcePublicKey: 'not-a-key', destination: VAULT, amount: '1' }),
    ).rejects.toMatchObject({ code: 'INVALID_PUBLIC_KEY' });
    expect(loadAccount).not.toHaveBeenCalled();
  });
});

describe('verifyNativeXlmPaymentOnChain', () => {
  // Horizon resolves a muxed destination's `to` to the base G-address and reports the
  // muxed address separately in `to_muxed` — this is the real response shape.
  const MUXED_DEST = 'MBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIAAAAAAAAAAAARGXI';
  const okParams = {
    txHash: 'a'.repeat(64),
    destination: MUXED_DEST,
    minAmount: '0.70',
  };

  it('verifies a successful matching payment to a muxed destination', async () => {
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({
      records: [
        { type: 'payment', to: VAULT, to_muxed: MUXED_DEST, asset_type: 'native', amount: '0.70' },
      ],
    });
    const result = await verifyNativeXlmPaymentOnChain(okParams);
    expect(result).toEqual({ verified: true, actualAmount: '0.70' });
  });

  it('rejects when the transaction is not found', async () => {
    transactionCall.mockRejectedValueOnce(new Error('404'));
    const result = await verifyNativeXlmPaymentOnChain(okParams);
    expect(result.verified).toBe(false);
  });

  it('rejects an unsuccessful transaction', async () => {
    transactionCall.mockResolvedValueOnce({ successful: false });
    const result = await verifyNativeXlmPaymentOnChain(okParams);
    expect(result).toMatchObject({
      verified: false,
      reason: expect.stringContaining('not successful'),
    });
  });

  it('rejects when no operation pays the vault destination', async () => {
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({ records: [] });
    const result = await verifyNativeXlmPaymentOnChain(okParams);
    expect(result.verified).toBe(false);
  });

  it('rejects when the received asset is not native XLM', async () => {
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({
      records: [
        {
          type: 'payment',
          to: VAULT,
          to_muxed: MUXED_DEST,
          asset_type: 'credit_alphanum4',
          amount: '5.00',
        },
      ],
    });
    const result = await verifyNativeXlmPaymentOnChain(okParams);
    expect(result).toMatchObject({
      verified: false,
      reason: expect.stringContaining('wrong asset'),
    });
  });

  it('rejects when the received amount is below the minimum', async () => {
    transactionCall.mockResolvedValueOnce({ successful: true });
    operationsCall.mockResolvedValueOnce({
      records: [
        { type: 'payment', to: VAULT, to_muxed: MUXED_DEST, asset_type: 'native', amount: '0.10' },
      ],
    });
    const result = await verifyNativeXlmPaymentOnChain(okParams);
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
    loadAccount.mockResolvedValueOnce(new Account(PAYER, '100'));
    const built = await buildNativeXlmPayment({
      sourcePublicKey: PAYER,
      destination: VAULT,
      amount: '1.00',
    });
    submitTransaction.mockRejectedValueOnce(new Error('tx_failed'));
    await expect(submitSignedXlmPayment(built.xdr)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
