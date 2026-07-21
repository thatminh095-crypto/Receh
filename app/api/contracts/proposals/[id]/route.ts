import type { NextRequest } from 'next/server';
import { fromError, ok } from '@/server/lib/http';
import { readProposal } from '@/server/lib/recehPoolContract';
import { stellar } from '@/server/config/stellar';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const proposal = await readProposal(id);
    return ok({ contractId: stellar.recehPoolContractId, proposal });
  } catch (err) {
    return fromError(err);
  }
}