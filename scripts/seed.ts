import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Keypair } from '@stellar/stellar-sdk';
import {
  contributors,
  grantProposals,
  horizonEvents,
  roundUps,
  vaultPool,
  votes,
} from '../src/server/db/schema';

const pool = new Pool({ connectionString: process.env.DRIZZLE_DATABASE_URL });
const db = drizzle(pool);

const VAULT_ADDRESS =
  process.env.VAULT_ADDRESS ?? 'GBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIE47';
const VAULT_CONTRACT =
  process.env.RECEH_POOL_CONTRACT_ID ??
  'CDNZX5D3WXVXMCBFZYCEB5SSRM5VHB2UZ55PKH55KSSOIJKCAACK6KUW';
const APY_PERCENT = 8.5;

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

async function fundedRecipient(): Promise<string> {
  const kp = Keypair.random();
  const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!res.ok && res.status !== 400) {
    throw new Error(`friendbot failed for ${kp.publicKey()}: ${res.status}`);
  }
  return kp.publicKey();
}

async function main() {
  await db.delete(votes);
  await db.delete(roundUps);
  await db.delete(horizonEvents);
  await db.delete(grantProposals);
  await db.delete(contributors);
  await db.delete(vaultPool);

  const [vault] = await db
    .insert(vaultPool)
    .values({
      name: 'Receh Community Vault',
      vaultAddress: VAULT_ADDRESS,
      vaultContractId: VAULT_CONTRACT,
      principalUsdc: '0',
      accruedYieldUsdc: '0',
      apyPercent: APY_PERCENT.toFixed(2),
      createdAt: hoursAgo(24 * 31),
      updatedAt: new Date(),
    })
    .returning();

  const people: Array<{ name: string; role: 'merchant' | 'shopper'; cause: string }> = [
    { name: 'Budi', role: 'shopper', cause: '' },
    { name: 'Sari', role: 'merchant', cause: 'Local food stall, Surabaya' },
    { name: 'Eko', role: 'shopper', cause: '' },
  ];
  const contributorRows = await db
    .insert(contributors)
    .values(people.map((p, i) => ({ ...p, muxIndex: i + 1 })))
    .returning();

  const purchasePlan: Array<{ idx: number; purchase: number }> = [
    { idx: 0, purchase: 4.3 },
    { idx: 0, purchase: 2.65 },
    { idx: 1, purchase: 9.1 },
    { idx: 2, purchase: 6.2 },
    { idx: 2, purchase: 3.4 },
  ];

  const totals = new Map<string, { total: number; count: number }>();
  let hOffset = 60;
  for (const plan of purchasePlan) {
    const c = contributorRows[plan.idx];
    const contribution = Math.round((Math.ceil(plan.purchase) - plan.purchase) * 100) / 100;
    await db.insert(roundUps).values({
      contributorId: c.id,
      vaultId: vault.id,
      purchaseUsdc: plan.purchase.toFixed(2),
      contributionUsdc: contribution.toFixed(2),
      muxedAddress: VAULT_ADDRESS,
      txHash: '',
      createdAt: hoursAgo(hOffset),
    });
    hOffset -= 8;
    const t = totals.get(c.id) ?? { total: 0, count: 0 };
    t.total += contribution;
    t.count += 1;
    totals.set(c.id, t);
  }

  for (const [id, t] of totals) {
    await pool.query(
      'UPDATE contributors SET total_contributed_usdc = $1, round_up_count = $2 WHERE id = $3',
      [t.total.toFixed(2), t.count, id],
    );
  }

  const principal = [...totals.values()].reduce((a, t) => a + t.total, 0);
  const dailyRate = APY_PERCENT / 100 / 365;
  const balance = principal * (1 + dailyRate) ** 31;
  const accrued = balance - principal;
  await pool.query(
    'UPDATE vault_pool SET principal_usdc = $1, accrued_yield_usdc = $2 WHERE id = $3',
    [principal.toFixed(2), accrued.toFixed(4), vault.id],
  );

  const [solar, water, lab] = await Promise.all([
    fundedRecipient(),
    fundedRecipient(),
    fundedRecipient(),
  ]);

  const proposalRows = await db
    .insert(grantProposals)
    .values([
      {
        vaultId: vault.id,
        title: 'Solar lamps for Kampung Nelayan',
        organization: 'Kampung Nelayan fishing community',
        description:
          'Solar lamps for 40 fishing families so children can study after dark and boats launch safely before dawn.',
        payoutAddress: solar,
        requestedUsdc: '1.50',
        votingClosesAt: daysFromNow(2),
        status: 'voting',
        createdAt: hoursAgo(120),
      },
      {
        vaultId: vault.id,
        title: 'Clean water filter Desa Cikaret',
        organization: 'Desa Cikaret village council',
        description:
          'Install a community water filter serving 60 households so families stop boiling river water for drinking.',
        payoutAddress: water,
        requestedUsdc: '1.20',
        votingClosesAt: daysFromNow(2),
        status: 'voting',
        createdAt: hoursAgo(110),
      },
      {
        vaultId: vault.id,
        title: 'Computer lab SMK Purwakarta',
        organization: 'SMK Purwakarta vocational school',
        description:
          'Refurbish six computers for the vocational school lab so students can learn digital skills.',
        payoutAddress: lab,
        requestedUsdc: '0.90',
        votingClosesAt: daysFromNow(2),
        status: 'voting',
        createdAt: hoursAgo(100),
      },
    ])
    .returning();

  const voteValues: (typeof votes.$inferInsert)[] = [];
  const weightOf = (idx: number) => (totals.get(contributorRows[idx].id)?.total ?? 0).toFixed(2);
  for (const idx of [0, 1]) {
    voteValues.push({
      proposalId: proposalRows[0].id,
      contributorId: contributorRows[idx].id,
      weightUsdc: weightOf(idx),
    });
  }
  voteValues.push({
    proposalId: proposalRows[1].id,
    contributorId: contributorRows[2].id,
    weightUsdc: weightOf(2),
  });
  await db.insert(votes).values(voteValues);

  for (const p of proposalRows) {
    const r = await pool.query(
      'SELECT COALESCE(SUM(weight_usdc::numeric),0) AS w FROM votes WHERE proposal_id = $1',
      [p.id],
    );
    await pool.query('UPDATE grant_proposals SET vote_weight_usdc = $1 WHERE id = $2', [
      Number(r.rows[0].w).toFixed(2),
      p.id,
    ]);
  }

  await db.insert(horizonEvents).values([
    {
      vaultId: vault.id,
      contributorId: contributorRows[0].id,
      eventType: 'roundup',
      amount: '0.70',
      label: 'Spare change routed into the vault',
      txHash: '',
      createdAt: hoursAgo(8),
    },
    {
      vaultId: vault.id,
      eventType: 'yield',
      amount: accrued.toFixed(4),
      label: 'Vault yield accrued',
      txHash: '',
      createdAt: hoursAgo(4),
    },
  ]);

  console.log(
    `seeded: vault ${vault.id}, ${contributorRows.length} contributors, ${purchasePlan.length} round-ups, ${proposalRows.length} proposals`,
  );
  console.log(`recipients: solar=${solar} water=${water} lab=${lab}`);
  await pool.end();
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
