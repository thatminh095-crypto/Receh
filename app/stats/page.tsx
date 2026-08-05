import { db } from '@/server/db/client';
import { contributors, grantProposals, roundUps } from '@/server/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { getVaultStats } from '@/server/service/vault.service';

export const dynamic = 'force-dynamic';

type StatCard = {
  label: string;
  value: string;
  hint?: string;
};

function fmtUsdc(n: string | number | null | undefined): string {
  if (n === null || n === undefined) return '0.00';
  const num = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(num)) return '0.00';
  return num.toFixed(2);
}

export default async function StatsPage() {
  let uniqueWallets = 0;
  let contributorRows = 0;
  let vault:
    | { principalUsdc: string; accruedYieldUsdc: string; poolTotalUsdc: string }
    | null = null;
  let proposalRows: Array<{ id: string; title: string; amount: string; status: string }> = [];
  let recentRoundUps: Array<{ id: string; contributor: string; amount: string; createdAt: Date }> = [];

  try {
    const [walletRow] = await db
      .select({
        cnt: sql<number>`count(distinct nullif(${contributors.stellarAddress},''))::int`,
      })
      .from(contributors);
    uniqueWallets = Number(walletRow?.cnt ?? 0);

    const [cntRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(contributors);
    contributorRows = Number(cntRow?.cnt ?? 0);
  } catch {
    uniqueWallets = 0;
    contributorRows = 0;
  }

  try {
    vault = await getVaultStats();
  } catch {
    vault = null;
  }

  try {
    const rows = await db
      .select({
        id: grantProposals.id,
        title: grantProposals.title,
        amount: grantProposals.requestedUsdc,
        status: grantProposals.status,
      })
      .from(grantProposals)
      .orderBy(desc(grantProposals.createdAt))
      .limit(10);
    proposalRows = rows;
  } catch {
    proposalRows = [];
  }

  try {
    const rows = await db
      .select({
        id: roundUps.id,
        contributor: contributors.stellarAddress,
        amount: roundUps.contributionUsdc,
        createdAt: roundUps.createdAt,
      })
      .from(roundUps)
      .innerJoin(contributors, eq(roundUps.contributorId, contributors.id))
      .orderBy(desc(roundUps.createdAt))
      .limit(10);
    recentRoundUps = rows;
  } catch {
    recentRoundUps = [];
  }

  const cards: StatCard[] = [
    { label: 'Connected wallets', value: String(uniqueWallets), hint: 'distinct Freighter accounts' },
    { label: 'Contributors', value: String(contributorRows), hint: 'people registered in the pool' },
    { label: 'Round-ups', value: String(recentRoundUps.length) },
    { label: 'Pool principal', value: fmtUsdc(vault?.principalUsdc), hint: 'USDC in the vault' },
    { label: 'Pool total', value: fmtUsdc(vault?.poolTotalUsdc), hint: 'principal + accrued yield' },
    { label: 'Accrued yield', value: fmtUsdc(vault?.accruedYieldUsdc), hint: 'simulated 8.5% APY' },
  ];

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Receh — community impact pool</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>Live stats from this pool. Updated every page load.</p>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              padding: 16,
              background: '#fff',
            }}
          >
            <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{c.value}</div>
            {c.hint && <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{c.hint}</div>}
          </div>
        ))}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Recent round-ups</h2>
        {recentRoundUps.length === 0 ? (
          <p style={{ color: '#999' }}>No round-ups yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5' }}>
                <th style={{ padding: 8 }}>Contributor</th>
                <th style={{ padding: 8 }}>Amount (USDC)</th>
                <th style={{ padding: 8 }}>When</th>
              </tr>
            </thead>
            <tbody>
              {recentRoundUps.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f3f3f3' }}>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
                    {r.contributor ? `${r.contributor.slice(0, 6)}…${r.contributor.slice(-6)}` : 'unknown'}
                  </td>
                  <td style={{ padding: 8 }}>{fmtUsdc(r.amount)}</td>
                  <td style={{ padding: 8, color: '#666' }}>
                    {new Date(r.createdAt).toISOString().slice(0, 19).replace('T', ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Grant proposals</h2>
        {proposalRows.length === 0 ? (
          <p style={{ color: '#999' }}>No proposals yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5' }}>
                <th style={{ padding: 8 }}>Title</th>
                <th style={{ padding: 8 }}>Amount (USDC)</th>
                <th style={{ padding: 8 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {proposalRows.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f3f3f3' }}>
                  <td style={{ padding: 8 }}>{p.title}</td>
                  <td style={{ padding: 8 }}>{fmtUsdc(p.amount)}</td>
                  <td style={{ padding: 8 }}>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}