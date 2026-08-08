import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { created, fromError } from '@/server/lib/http';
import { castVote } from '@/server/service/grant.service';

export const dynamic = 'force-dynamic';

const schema = z.object({ contributorId: z.string().uuid() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = schema.parse(await req.json());
    return created(await castVote(id, body.contributorId));
  } catch (err) {
    return fromError(err);
  }
}
