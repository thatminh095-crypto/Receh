import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { created, fromError, ok } from '@/server/lib/http';
import { createProposal, listProposals } from '@/server/service/grant.service';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  vaultId: z.string().uuid(),
  title: z.string().min(2).max(160),
  organization: z.string().min(2).max(160),
  description: z.string().max(600).default(''),
  payoutAddress: z.string().min(10),
  requestedUsdc: z.string().regex(/^\d+(\.\d{1,7})?$/),
  votingClosesAt: z.string().datetime(),
});

export async function GET(req: NextRequest) {
  try {
    const vaultId = req.nextUrl.searchParams.get('vaultId') ?? undefined;
    return ok(await listProposals(vaultId));
  } catch (err) {
    return fromError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = createSchema.parse(await req.json());
    return created(
      await createProposal({ ...body, votingClosesAt: new Date(body.votingClosesAt) }),
    );
  } catch (err) {
    return fromError(err);
  }
}
