import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, fromError, ok } from '@/server/lib/http';
import { readSession } from '@/server/lib/session';
import { buildCreateGrantXdr, type CreateGrantPrepared } from '@/server/lib/recehPoolContract';

export const dynamic = 'force-dynamic';

const schema = z.object({
  recipient: z.string().min(10),
  amountStroops: z.string().regex(/^[0-9]+$/),
  titleHashHex32: z.string().regex(/^[a-f0-9]{64}$/i),
});

function requireSession(req: NextRequest) {
  const cookieName = process.env.SESSION_COOKIE_NAME ?? 'receh_session';
  const token = req.cookies.get(cookieName)?.value ?? '';
  return readSession(token);
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession(req);
    if (!session) {
      throw new AppError('UNAUTHORIZED', 'Connect with Freighter before creating a grant', 401);
    }
    const body = schema.parse(await req.json());
    const prepared: CreateGrantPrepared = await buildCreateGrantXdr({
      proposer: session.publicKey,
      recipient: body.recipient,
      amountStroops: body.amountStroops,
      titleHashHex32: body.titleHashHex32,
    });
    return ok(prepared);
  } catch (err) {
    return fromError(err);
  }
}
