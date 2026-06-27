import { beforeEach, describe, expect, it, vi } from 'vitest';

const q: { results: unknown[][]; updates: unknown[] } = { results: [], updates: [] };
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
  const insertChain = { values: () => ({ returning: () => Promise.resolve(nextResult()) }) };
  const updateChain = {
    set: (v: unknown) => {
      q.updates.push(v);
      return { where: () => ({ returning: () => Promise.resolve(nextResult()) }) };
    },
  };
  return {
    db: {
      select: () => selectChain,
      insert: () => insertChain,
      update: () => updateChain,
    },
  };
});

vi.mock('@/server/config/stellar', () => ({
  stellar: {
    usdcAssetCode: 'USDC',
    usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
}));

const G = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

// Mock vault.service so round-up flow is isolated from DB-heavy vault logic.
const depositToVault = vi.fn(async () => ({ id: 'v1', principalUsdc: '100.70' }));
const getVault = vi.fn(async () => ({ id: 'v1', vaultAddress: G }));
vi.mock('@/server/service/vault.service', () => ({
  depositToVault: (...a: unknown[]) => depositToVault(...(a as [])),
  getVault: () => getVault(),
}));

import {
  createContributor,
  getContributor,
  listContributors,
  listRoundUps,
  quoteRoundUp,
  recordRoundUp,
} from '@/server/service/roundup.service';

beforeEach(() => {
  q.results = [];
  q.updates = [];
  depositToVault.mockClear();
  getVault.mockClear();
});

const contributor = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Budi',
  role: 'shopper',
  cause: '',
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
      [{ muxIndex: 1 }, { muxIndex: 3 }], // existing indexes
      [contributor({ muxIndex: 4 })], // insert returning
    ];
    const out = await createContributor({ name: 'New', role: 'shopper', cause: '' });
    expect(out.muxIndex).toBe(4);
  });

  it('quoteRoundUp builds a SEP-7 uri and muxed address', async () => {
    q.results = [[contributor()]]; // getContributor
    const out = await quoteRoundUp('c1', '4.30');
    expect(out.contribution).toBe('0.70');
    expect(out.total).toBe('5.00');
    expect(out.sep7Uri).toContain('web+stellar:pay');
    expect(out.muxedAddress.startsWith('M')).toBe(true);
  });

  it('recordRoundUp persists, attributes, and deposits to the vault', async () => {
    q.results = [
      [contributor()], // getContributor (inside quote)
      [{ id: 'r1', contributionUsdc: '0.70' }], // insert round-up returning
    ];
    const out = await recordRoundUp({ contributorId: 'c1', purchaseUsdc: '4.30' });
    expect(out.contribution).toBe('0.70');
    expect(depositToVault).toHaveBeenCalledWith('v1', '0.70');
    // contributor total bumped 3.00 -> 3.70
    expect(q.updates[0]).toMatchObject({ totalContributedUsdc: '3.70', roundUpCount: 5 });
  });

  it('recordRoundUp rejects a whole-number purchase (no spare change)', async () => {
    q.results = [[contributor()]];
    await expect(
      recordRoundUp({ contributorId: 'c1', purchaseUsdc: '5.00' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('listRoundUps returns recent rows', async () => {
    q.results = [[{ id: 'r1' }, { id: 'r2' }]];
    expect(await listRoundUps()).toHaveLength(2);
  });
});
