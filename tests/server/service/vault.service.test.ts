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

import {
  createVault,
  depositToVault,
  getVault,
  getVaultById,
  getVaultStats,
  withdrawFromVault,
} from '@/server/service/vault.service';

beforeEach(() => {
  q.results = [];
  q.updates = [];
});

const vaultRow = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  name: 'Vault',
  vaultAddress: 'G...',
  vaultContractId: 'C...',
  principalUsdc: '100.00',
  accruedYieldUsdc: '1.0000',
  apyPercent: '8.20',
  createdAt: new Date(Date.now() - 31 * 86_400_000),
  updatedAt: new Date(),
  ...over,
});

describe('vault.service', () => {
  it('getVault returns the latest vault', async () => {
    q.results = [[vaultRow()]];
    expect((await getVault()).id).toBe('v1');
  });

  it('getVault throws when none seeded', async () => {
    q.results = [[]];
    await expect(getVault()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getVaultById throws NOT_FOUND', async () => {
    q.results = [[]];
    await expect(getVaultById('x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('createVault inserts and returns a row', async () => {
    q.results = [[vaultRow()]];
    const out = await createVault({ vaultAddress: 'G...' } as never);
    expect(out.id).toBe('v1');
  });

  it('depositToVault grows principal and recomputes yield', async () => {
    q.results = [[vaultRow({ principalUsdc: '100.00' })], [vaultRow({ principalUsdc: '100.70' })]];
    const out = await depositToVault('v1', '0.70');
    expect(out).toBeDefined();
    expect(q.updates[0]).toMatchObject({ principalUsdc: '100.70' });
    expect(
      Number.parseFloat((q.updates[0] as { accruedYieldUsdc: string }).accruedYieldUsdc),
    ).toBeGreaterThan(0);
  });

  it('withdrawFromVault reduces principal and zeroes yield', async () => {
    q.results = [[vaultRow({ principalUsdc: '100.00', accruedYieldUsdc: '2.00' })], [vaultRow()]];
    await withdrawFromVault('v1', '35.00');
    const update = q.updates[0] as { principalUsdc: string; accruedYieldUsdc: string };
    expect(Number.parseFloat(update.accruedYieldUsdc)).toBeCloseTo(0, 4);
    expect(Number.parseFloat(update.principalUsdc)).toBeCloseTo(67, 0);
  });

  it('withdrawFromVault draws from yield first when amount is below yield balance', async () => {
    q.results = [
      [vaultRow({ principalUsdc: '100.00', accruedYieldUsdc: '5.00' })],
      [vaultRow()],
    ];
    await withdrawFromVault('v1', '2.00');
    const update = q.updates[0] as { principalUsdc: string; accruedYieldUsdc: string };
    expect(update.principalUsdc).toBe('100.00');
    expect(Number.parseFloat(update.accruedYieldUsdc)).toBeCloseTo(3, 4);
  });

  it('getVaultStats aggregates pool, contributors and grants', async () => {
    q.results = [
      [vaultRow({ principalUsdc: '50.00', accruedYieldUsdc: '0.5000' })], // getVault
      [{ contribution: '0.70' }, { contribution: '0.35' }], // round-ups
      [{ role: 'merchant' }, { role: 'shopper' }, { role: 'shopper' }], // contributors
      [
        { status: 'disbursed', requestedUsdc: '35.00' },
        { status: 'voting', requestedUsdc: '28.00' },
      ], // proposals
    ];
    const stats = await getVaultStats();
    expect(stats.poolTotalUsdc).toBe('50.50');
    expect(stats.totalRoundUps).toBe(2);
    expect(stats.contributorCount).toBe(3);
    expect(stats.merchantCount).toBe(1);
    expect(stats.shopperCount).toBe(2);
    expect(stats.proposalCount).toBe(2);
    expect(stats.grantsDisbursed).toBe(1);
    expect(stats.grantedUsdc).toBe('35.00');
  });
});
