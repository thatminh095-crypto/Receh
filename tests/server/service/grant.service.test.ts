import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/config/env', () => ({
  env: {
    VAULT_SECRET_KEY: 'SDL4SWRGFBZ5XBB5EORL3BHLUSETFBVVQ6OIESURFR7D4BFQQJKMJI3P',
    VAULT_ADDRESS: 'GBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIE47',
    DRIZZLE_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/receh_test',
    SESSION_SECRET: 'receh-test-session-secret-minimum-32chars-ok',
    STELLAR_NETWORK: 'testnet',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    USDC_ASSET_CODE: 'USDC',
    USDC_ASSET_ISSUER_TESTNET: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
}));

vi.mock('@/server/lib/disburse', () => ({
  payFromVault: vi.fn(async () => 'disbursal-hash-abc123'),
}));

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

const getContributor = vi.fn(async () => ({ id: 'c1', totalContributedUsdc: '5.00' }));
vi.mock('@/server/service/roundup.service', () => ({
  getContributor: () => getContributor(),
}));

const withdrawFromVault = vi.fn(async () => ({ id: 'v1' }));
const getVault = vi.fn(async () => ({ id: 'v1' }));
vi.mock('@/server/service/vault.service', () => ({
  withdrawFromVault: (...a: unknown[]) => withdrawFromVault(...(a as [])),
  getVault: () => getVault(),
}));

import {
  castVote,
  closeAndDisburse,
  closeVotingWindow,
  createProposal,
  disburseGrant,
  getProposal,
  listProposals,
  tallyProposal,
} from '@/server/service/grant.service';

beforeEach(() => {
  q.results = [];
  q.updates = [];
  getContributor.mockClear();
  withdrawFromVault.mockClear();
  getVault.mockClear();
});

const proposal = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  vaultId: 'v1',
  title: 'Posyandu',
  organization: 'RW 04',
  requestedUsdc: '35.00',
  voteWeightUsdc: '0',
  status: 'voting',
  disburseTxHash: '',
  ...over,
});

describe('grant.service', () => {
  it('listProposals with and without vaultId', async () => {
    q.results = [[proposal()]];
    expect(await listProposals('v1')).toHaveLength(1);
    q.results = [[proposal(), proposal({ id: 'p2' })]];
    expect(await listProposals()).toHaveLength(2);
  });

  it('getProposal throws NOT_FOUND', async () => {
    q.results = [[]];
    await expect(getProposal('x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('createProposal inserts and returns a row', async () => {
    q.results = [[proposal()]];
    const out = await createProposal({
      vaultId: 'v1',
      title: 'X',
      organization: 'Y',
      payoutAddress: 'G...',
      requestedUsdc: '10.00',
      votingClosesAt: new Date(),
    } as never);
    expect(out.id).toBe('p1');
  });

  it('tallyProposal sums weights', async () => {
    q.results = [[{ weight: '5.00' }, { weight: '3.50' }]];
    const t = await tallyProposal('p1');
    expect(t.voteCount).toBe(2);
    expect(t.totalWeightUsdc).toBe('8.50');
  });

  it('castVote records a weighted vote and updates tally', async () => {
    q.results = [
      [proposal({ status: 'voting' })], // getProposal
      [], // existing vote check
      [{ id: 'vote1' }], // insert vote returning
      [{ weight: '5.00' }], // tally
    ];
    const out = await castVote('p1', 'c1');
    expect(out.vote.id).toBe('vote1');
    expect(out.tally.totalWeightUsdc).toBe('5.00');
    expect(q.updates[0]).toMatchObject({ voteWeightUsdc: '5.00' });
  });

  it('castVote rejects when voting closed', async () => {
    q.results = [[proposal({ status: 'approved' })]];
    await expect(castVote('p1', 'c1')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('castVote rejects a duplicate vote', async () => {
    q.results = [[proposal({ status: 'voting' })], [{ id: 'existing' }]];
    await expect(castVote('p1', 'c1')).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('closeVotingWindow approves the heaviest proposal, rejects the rest', async () => {
    q.results = [
      [
        proposal({ id: 'pA', voteWeightUsdc: '5.00' }),
        proposal({ id: 'pB', voteWeightUsdc: '12.00' }),
        proposal({ id: 'pC', voteWeightUsdc: '1.00' }),
      ],
    ];
    const res = await closeVotingWindow('v1');
    expect(res.winnerId).toBe('pB');
    expect(res.approved).toBe(1);
    expect(res.rejected).toBe(2);
    // exactly one proposal is approved, the rest rejected
    const statuses = (q.updates as Array<{ status: string }>).map((u) => u.status);
    expect(statuses.filter((s) => s === 'approved')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'rejected')).toHaveLength(2);
  });

  it('closeVotingWindow with no candidates returns null', async () => {
    q.results = [[]];
    const res = await closeVotingWindow('v1');
    expect(res.winnerId).toBeNull();
  });

  it('disburseGrant withdraws from vault and flips status', async () => {
    q.results = [[proposal({ status: 'approved' })], [proposal({ status: 'disbursed' })]];
    const out = await disburseGrant('p1');
    expect(withdrawFromVault).toHaveBeenCalledWith('v1', '35.00');
    expect(out.txHash).toMatch(/^disb/);
    expect(q.updates[0]).toMatchObject({ status: 'disbursed' });
  });

  it('disburseGrant rejects non-approved proposals', async () => {
    q.results = [[proposal({ status: 'voting' })]];
    await expect(disburseGrant('p1')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('closeAndDisburse closes the window then disburses the winner', async () => {
    q.results = [
      [proposal({ id: 'pA', voteWeightUsdc: '9.00', status: 'voting' })], // closeVotingWindow candidates
      [proposal({ id: 'pA', status: 'approved' })], // disburse -> getProposal
      [proposal({ id: 'pA', status: 'disbursed' })], // disburse update returning
    ];
    const out = await closeAndDisburse('v1');
    expect(out.winnerId).toBe('pA');
    expect(out.txHash).toMatch(/^disb/);
  });

  it('closeAndDisburse returns empty when nothing to close', async () => {
    q.results = [[]];
    const out = await closeAndDisburse('v1');
    expect(out.winnerId).toBeNull();
    expect(out.txHash).toBe('');
  });
});
