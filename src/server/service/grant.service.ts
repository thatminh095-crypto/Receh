import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { grantProposals, horizonEvents, type NewGrantProposal, votes } from '@/server/db/schema';
import { payFromVault } from '@/server/lib/disburse';
import { AppError } from '@/server/lib/http';
import { getContributor } from './roundup.service';
import { getVault, withdrawFromVault } from './vault.service';

export async function listProposals(vaultId?: string) {
  if (vaultId) {
    return db
      .select()
      .from(grantProposals)
      .where(eq(grantProposals.vaultId, vaultId))
      .orderBy(desc(grantProposals.createdAt));
  }
  return db.select().from(grantProposals).orderBy(desc(grantProposals.createdAt));
}

export async function getProposal(id: string) {
  const rows = await db.select().from(grantProposals).where(eq(grantProposals.id, id));
  if (!rows[0]) throw new AppError('NOT_FOUND', 'Proposal not found', 404);
  return rows[0];
}

export async function createProposal(data: NewGrantProposal) {
  const rows = await db.insert(grantProposals).values(data).returning();
  return rows[0]!;
}

export async function tallyProposal(proposalId: string) {
  const rows = await db
    .select({ weight: votes.weightUsdc })
    .from(votes)
    .where(eq(votes.proposalId, proposalId));
  const totalWeight = rows.reduce((acc, v) => acc + Number.parseFloat(v.weight), 0);
  return { voteCount: rows.length, totalWeightUsdc: totalWeight.toFixed(2) };
}

export async function castVote(proposalId: string, contributorId: string) {
  const proposal = await getProposal(proposalId);
  if (proposal.status !== 'voting') {
    throw new AppError('CONFLICT', 'Voting window is closed for this proposal', 409);
  }
  const contributor = await getContributor(contributorId);

  const existing = await db
    .select()
    .from(votes)
    .where(and(eq(votes.proposalId, proposalId), eq(votes.contributorId, contributorId)));
  if (existing[0]) {
    throw new AppError('ALREADY_EXISTS', 'You have already voted on this proposal', 409);
  }

  const weight = contributor.totalContributedUsdc;
  const rows = await db
    .insert(votes)
    .values({ proposalId, contributorId, weightUsdc: weight })
    .returning();

  const tally = await tallyProposal(proposalId);
  await db
    .update(grantProposals)
    .set({ voteWeightUsdc: tally.totalWeightUsdc })
    .where(eq(grantProposals.id, proposalId));

  return { vote: rows[0]!, tally };
}

export async function closeVotingWindow(vaultId: string) {
  const candidates = await db
    .select()
    .from(grantProposals)
    .where(and(eq(grantProposals.vaultId, vaultId), eq(grantProposals.status, 'voting')));

  if (candidates.length === 0) return { winnerId: null as string | null, approved: 0, rejected: 0 };

  const ranked = candidates
    .map((p) => ({ id: p.id, weight: Number.parseFloat(p.voteWeightUsdc) }))
    .sort((a, b) => b.weight - a.weight);
  const winnerId = ranked[0].id;

  for (const c of candidates) {
    await db
      .update(grantProposals)
      .set({ status: c.id === winnerId ? 'approved' : 'rejected' })
      .where(eq(grantProposals.id, c.id));
  }

  return { winnerId, approved: 1, rejected: candidates.length - 1 };
}

export async function disburseGrant(proposalId: string) {
  const proposal = await getProposal(proposalId);
  if (proposal.status !== 'approved') {
    throw new AppError('CONFLICT', 'Only approved proposals can be disbursed', 409);
  }

  const txHash = await payFromVault(proposal.payoutAddress, proposal.requestedUsdc);

  await withdrawFromVault(proposal.vaultId, proposal.requestedUsdc);

  const rows = await db
    .update(grantProposals)
    .set({ status: 'disbursed', disburseTxHash: txHash })
    .where(eq(grantProposals.id, proposalId))
    .returning();

  await db.insert(horizonEvents).values({
    vaultId: proposal.vaultId,
    proposalId: proposal.id,
    eventType: 'disburse',
    amount: proposal.requestedUsdc,
    label: `Grant disbursed to ${proposal.organization}`,
    txHash,
  });

  return { proposal: rows[0]!, txHash };
}

export async function closeAndDisburse(vaultId?: string) {
  const vault = vaultId ? { id: vaultId } : await getVault();
  const result = await closeVotingWindow(vault.id);
  if (!result.winnerId) return { winnerId: null, txHash: '' };
  const { txHash } = await disburseGrant(result.winnerId);
  return { winnerId: result.winnerId, txHash };
}
