import { count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { contributors, grantProposals, roundUps, votes } from '@/server/db/schema';
import { fromError, ok } from '@/server/lib/http';
import { getVaultStats } from '@/server/service/vault.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const vault = await getVaultStats().catch(() => null);
    const [c] = await db.select({ value: count() }).from(contributors);
    const [r] = await db.select({ value: count() }).from(roundUps);
    const [p] = await db.select({ value: count() }).from(grantProposals);
    const [v] = await db.select({ value: count() }).from(votes);
    const [w] = await db
      .select({
        value: sql<number>`count(distinct nullif(${contributors.stellarAddress},''))::int`,
      })
      .from(contributors);

    return ok({
      uniqueWallets: Number(w?.value ?? 0),
      logins: c?.value ?? 0,
      contributors: c?.value ?? 0,
      roundUps: r?.value ?? 0,
      proposals: p?.value ?? 0,
      votes: v?.value ?? 0,
      grantsDisbursed: vault?.grantsDisbursed ?? 0,
      poolTotalUsdc: vault?.poolTotalUsdc ?? '0.00',
      accruedYieldUsdc: vault?.accruedYieldUsdc ?? '0.0000',
    });
  } catch (err) {
    return fromError(err);
  }
}
