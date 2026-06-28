import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { fromError, ok } from '@/server/lib/http';
import { buildDisburseXdr } from '@/server/lib/recehPoolContract';
import { getProposal } from '@/server/service/grant.service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  proposalId: z.string().min(1),
  source: z.string().min(10),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const proposal = await getProposal(body.proposalId);
    if (proposal.status !== 'approved' && proposal.status !== 'voting') {
      throw new Error(
        `Proposal ${body.proposalId} is not in an approved or voting state (current: ${proposal.status})`,
      );
    }
    const prepared = await buildDisburseXdr({
      source: body.source,
      proposalId: proposal.id,
    });
    return ok(prepared);
  } catch (err) {
    return fromError(err);
  }
}