import type { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/server/db/client';
import { grantProposals, horizonEvents } from '@/server/db/schema';
import { fromError, ok } from '@/server/lib/http';
import { submitSignedInvoke } from '@/server/lib/recehPoolContract';
import { withdrawFromVault } from '@/server/service/vault.service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  signedXdr: z.string().min(1),
  proposalId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const proposalRows = await db
      .select()
      .from(grantProposals)
      .where(eq(grantProposals.id, body.proposalId));
    const proposal = proposalRows[0];
    if (!proposal) {
      throw new Error(`Proposal ${body.proposalId} not found`);
    }

    const { hash } = await submitSignedInvoke(body.signedXdr);

    await withdrawFromVault(proposal.vaultId, proposal.requestedUsdc);

    const updated = await db
      .update(grantProposals)
      .set({ status: 'disbursed', disburseTxHash: hash })
      .where(eq(grantProposals.id, body.proposalId))
      .returning();

    await db.insert(horizonEvents).values({
      vaultId: proposal.vaultId,
      proposalId: proposal.id,
      eventType: 'disburse',
      amount: proposal.requestedUsdc,
      label: `Grant disbursed (Soroban) to ${proposal.organization}`,
      txHash: hash,
    });

    return ok({ hash, proposal: updated[0]! });
  } catch (err) {
    return fromError(err);
  }
}