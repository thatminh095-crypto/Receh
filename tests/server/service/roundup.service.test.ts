import { beforeEach, describe, expect, it, vi } from 'vitest';

const q: { results: unknown[][]; updates: unknown[]; insertError: Error | null } = {
  results: [],
  updates: [],
  insertError: null,
};
function nextResult(): unknown[] {
  return q.results.shift() ?? [];
}

vi.mock('@/server/db/client', () => {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () => Promise.resolve(nextResult()),
    then: (resolve: (v: unknown) => void) => resolve(nextResult()),
  };
  const insertChain = {
    values: () => ({
      returning: () => {
        if (q.insertError) return Promise.reject(q.insertError);
        return Promise.resolve(nextResult());
      },
    }),
  };
  const updateChain = {
    set: (v: unknown) => {
      q.updates.push(v);
      return { where: () => ({ returning: () => Promise.resolve(nextResult()) }) };
    },
  };
  const tx = {
    select: () => selectChain,
    insert: () => insertChain,
    update: () => updateChain,
    execute: () => Promise.resolve(undefined),
  };
  return {
    db: {
      select: () => selectChain,
      insert: () => insertChain,
      update: () => updateChain,
      execute: () => Promise.resolve(undefined),
      transaction: async (cb: (txArg: typeof tx) => Promise<unknown>) => cb(tx),
    },
  };
});

const G = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

// Mock vault.service so round-up flow is isolated from DB-heavy vault logic.
const depositToVault = vi.fn(async () => ({ id: 'v1', principalUsdc: '100.70' }));
const getVault = vi.fn(async () => ({ id: 'v1', vaultAddress: G }));
vi.mock('@/server/service/vault.service', () => ({
  depositToVault: (...a: unknown[]) => depositToVault(...(a as [])),
  getVault: () => getVault(),
}));

const buildRecordRoundupXdr = vi.fn(async () => ({
  xdr: 'AAAA-prepared-xdr',
  contractId: 'CXXX',
  networkPassphrase: 'Test SDF Network ; September 2015',
}));
vi.mock('@/server/lib/recehPoolContract', () => ({
  buildRecordRoundupXdr: (...a: unknown[]) => buildRecordRoundupXdr(...(a as [])),
}));

const buildNativeXlmPayment = vi.fn(async () => ({ xdr: 'AAAA-native-payment' }));
const verifyNativeXlmPaymentOnChain = vi.fn(async () => ({ verified: true, actualAmount: '0.70' }));
vi.mock('@/server/lib/xlmPayment', () => ({
  buildNativeXlmPayment: (...a: unknown[]) => buildNativeXlmPayment(...(a as [])),
  verifyNativeXlmPaymentOnChain: (...a: unknown[]) => verifyNativeXlmPaymentOnChain(...(a as [])),
}));

import {
  buildNativeXlmRoundUp,
  createContributor,
  getContributor,
  listContributors,
  listRoundUps,
  recordNativeXlmRoundUp,
} from '@/server/service/roundup.service';

beforeEach(() => {
  q.results = [];
  q.updates = [];
  q.insertError = null;
  depositToVault.mockClear();
  getVault.mockClear();
  buildRecordRoundupXdr.mockClear();
  buildNativeXlmPayment.mockClear();
  verifyNativeXlmPaymentOnChain.mockReset();
  verifyNativeXlmPaymentOnChain.mockResolvedValue({ verified: true, actualAmount: '0.70' });
});

const contributor = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Budi',
  role: 'shopper',
  cause: '',
  stellarAddress: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ',
  muxIndex: 2,
  totalContributedUsdc: '3.00',
  roundUpCount: 4,
  ...over,
});

describe('roundup.service', () => {
  it('listContributors returns rows', async () => {
    q.results = [[contributor()]];
    expect(await listContributors()).toHaveLength(1);
  });

  it('getContributor returns a row', async () => {
    q.results = [[contributor()]];
    expect((await getContributor('c1')).id).toBe('c1');
  });

  it('getContributor throws NOT_FOUND', async () => {
    q.results = [[]];
    await expect(getContributor('x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('createContributor assigns the next mux index', async () => {
    q.results = [
      [{ max: 3 }], // MAX(muxIndex) aggregate
      [contributor({ muxIndex: 4 })], // insert returning
    ];
    const out = await createContributor({ name: 'New', role: 'shopper', cause: '' });
    expect(out.muxIndex).toBe(4);
  });

  it('buildNativeXlmRoundUp builds a payment and muxed address', async () => {
    q.results = [[contributor()]]; // getContributor
    const out = await buildNativeXlmRoundUp(
      'GAEIMHCAB46FUYMWWVXAHSMOBK7VF7PKGX2OIBOG44K5FGL4T7NJPRC3',
      'c1',
      '4.3001234',
    );
    expect(out.contributionXlm).toBe('0.0008766');
    expect(out.roundedTotalXlm).toBe('4.3010000');
    expect(out.muxedAddress.startsWith('M')).toBe(true);
    expect(out.xdr).toBe('AAAA-native-payment');
  });

  it('buildNativeXlmRoundUp rejects a whole-number purchase (no spare change)', async () => {
    q.results = [[contributor()]];
    await expect(
      buildNativeXlmRoundUp(
        'GAEIMHCAB46FUYMWWVXAHSMOBK7VF7PKGX2OIBOG44K5FGL4T7NJPRC3',
        'c1',
        '5.00',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('recordNativeXlmRoundUp verifies on-chain, persists, attributes, and deposits', async () => {
    q.results = [
      [contributor()], // getContributor
      [{ id: 'r1', contributionUsdc: '0.70' }], // insert round-up returning
    ];
    const out = await recordNativeXlmRoundUp({
      contributorId: 'c1',
      purchaseXlm: '4.3001234',
      txHash: 'a'.repeat(64),
    });
    expect(verifyNativeXlmPaymentOnChain).toHaveBeenCalledTimes(1);
    expect(out.contribution).toBe('0.70');
    expect(depositToVault).toHaveBeenCalledWith('v1', '0.70');
    // Atomic SQL update — not a read-then-write literal, so we assert the shape of the
    // set() payload rather than a computed literal.
    expect(q.updates[0]).toHaveProperty('totalContributedUsdc');
    expect(q.updates[0]).toHaveProperty('roundUpCount');
    expect(buildRecordRoundupXdr).toHaveBeenCalledTimes(1);
    expect(out.contractAttempt.invoked).toBe(true);
    expect(out.contractAttempt.xdr).toBe('AAAA-prepared-xdr');
  });

  it('recordNativeXlmRoundUp rejects when on-chain verification fails', async () => {
    q.results = [[contributor()]];
    verifyNativeXlmPaymentOnChain.mockResolvedValueOnce({ verified: false, reason: 'nope' });
    await expect(
      recordNativeXlmRoundUp({
        contributorId: 'c1',
        purchaseXlm: '4.3001234',
        txHash: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('recordNativeXlmRoundUp rejects a replayed txHash as CONFLICT', async () => {
    q.results = [[contributor()]];
    q.insertError = new Error(
      'duplicate key value violates unique constraint "round_ups_tx_hash_unique"',
    );
    await expect(
      recordNativeXlmRoundUp({
        contributorId: 'c1',
        purchaseXlm: '4.3001234',
        txHash: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('recordNativeXlmRoundUp skips on-chain contract call when contributor lacks stellarAddress', async () => {
    q.results = [[contributor({ stellarAddress: '' })], [{ id: 'r1', contributionUsdc: '0.70' }]];
    const out = await recordNativeXlmRoundUp({
      contributorId: 'c1',
      purchaseXlm: '4.3001234',
      txHash: 'a'.repeat(64),
    });
    expect(buildRecordRoundupXdr).not.toHaveBeenCalled();
    expect(out.contractAttempt.invoked).toBe(false);
    expect(out.contractAttempt.reason).toContain('stellarAddress');
  });

  it('recordNativeXlmRoundUp rejects missing txHash', async () => {
    await expect(
      recordNativeXlmRoundUp({ contributorId: 'c1', purchaseXlm: '4.3001234', txHash: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('recordNativeXlmRoundUp rejects malformed txHash', async () => {
    await expect(
      recordNativeXlmRoundUp({ contributorId: 'c1', purchaseXlm: '4.3001234', txHash: 'not-hex' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('recordNativeXlmRoundUp rejects a whole-number purchase (no spare change)', async () => {
    q.results = [[contributor()]];
    await expect(
      recordNativeXlmRoundUp({ contributorId: 'c1', purchaseXlm: '5.00', txHash: 'a'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('listRoundUps returns recent rows', async () => {
    q.results = [[{ id: 'r1' }, { id: 'r2' }]];
    expect(await listRoundUps()).toHaveLength(2);
  });
});
