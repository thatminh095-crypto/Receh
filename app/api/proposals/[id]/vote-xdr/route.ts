import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, fromError, ok } from '@/server/lib/http';
import { readSession } from '@/server/lib/session';
import { buildVoteXdr, type VotePrepared } from '@/server/lib/recehPoolContract';

export const dynamic = 'force-dynamic';

const schema = z.object({
  inFavor: z.boolean(),
});

function requireSession(req: NextRequest) {
  const cookieName = process.env.SESSION_COOKIE_NAME ?? 'receh_session';
  const token = req.cookies.get(cookieName)?.value ?? '';
  return readSession(token);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(req);
    if (!session) {
      throw new AppError('UNAUTHORIZED', 'Connect with Freighter before voting', 401);
    }
    const { id } = await ctx.params;
    const body = schema.parse(await req.json());
    const prepared: VotePrepared = await buildVoteXdr({
      voter: session.publicKey,
      proposalId: id,
      inFavor: body.inFavor,
    });
    return ok(prepared);
  } catch (err) {
    return fromError(err);
  }
}
