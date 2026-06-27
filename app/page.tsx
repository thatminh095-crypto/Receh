import { desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { contributors, grantProposals, roundUps, votes } from '@/server/db/schema';
import { usdcToIdr } from '@/server/lib/roundup';
import { getVaultStats } from '@/server/service/vault.service';
import { RecehClient } from '@/ui/components/pages/receh-client';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ empty?: string }>;
}) {
  const { empty } = await searchParams;

  if (empty === '1') {
    return (
      <RecehClient
        empty
        stats={null}
        contributors={[]}
        proposals={[]}
        recentRoundUps={[]}
        idrRate={usdcToIdr(1)}
      />
    );
  }

  let stats: Awaited<ReturnType<typeof getVaultStats>> | null = null;
  let contributorRows: (typeof contributors.$inferSelect)[] = [];
  let proposalRows: Array<typeof grantProposals.$inferSelect & { voteCount: number }> = [];
  let roundUpRows: (typeof roundUps.$inferSelect)[] = [];

  try {
    stats = await getVaultStats();
    contributorRows = await db
      .select()
      .from(contributors)
      .orderBy(desc(contributors.totalContributedUsdc));
    const rawProposals = await db
      .select()
      .from(grantProposals)
      .orderBy(desc(grantProposals.createdAt));
    proposalRows = await Promise.all(
      rawProposals.map(async (p) => {
        const v = await db.select().from(votes).where(eq(votes.proposalId, p.id));
        return { ...p, voteCount: v.length };
      }),
    );
    roundUpRows = await db.select().from(roundUps).orderBy(desc(roundUps.createdAt)).limit(10);
  } catch {
    return (
      <RecehClient
        empty
        stats={null}
        contributors={[]}
        proposals={[]}
        recentRoundUps={[]}
        idrRate={usdcToIdr(1)}
      />
    );
  }

  return (
    <RecehClient
      stats={stats}
      contributors={contributorRows.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        cause: c.cause,
        totalContributedUsdc: c.totalContributedUsdc,
        roundUpCount: c.roundUpCount,
      }))}
      proposals={proposalRows.map((p) => ({
        id: p.id,
        title: p.title,
        organization: p.organization,
        description: p.description,
        requestedUsdc: p.requestedUsdc,
        voteWeightUsdc: p.voteWeightUsdc,
        status: p.status,
        disburseTxHash: p.disburseTxHash,
        voteCount: p.voteCount,
      }))}
      recentRoundUps={roundUpRows.map((r) => ({
        id: r.id,
        contributorId: r.contributorId,
        purchaseUsdc: r.purchaseUsdc,
        contributionUsdc: r.contributionUsdc,
        muxedAddress: r.muxedAddress,
        createdAt: r.createdAt.toISOString(),
      }))}
      idrRate={usdcToIdr(1)}
    />
  );
}
