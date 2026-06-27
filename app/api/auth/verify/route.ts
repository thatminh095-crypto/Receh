import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { signSession } from '@/server/lib/session';
import { fromError, ok } from '@/server/lib/http';

export const dynamic = 'force-dynamic';

const schema = z.object({
  publicKey: z.string().min(56),
  nonce: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const { publicKey, nonce } = schema.parse(await req.json());
    const cookieName = process.env.SESSION_COOKIE_NAME ?? 'receh_session';
    const session = await signSession({
      publicKey,
      nonce,
      issuedAt: Date.now(),
    });
    const response = ok({ publicKey, ok: true });
    response.cookies.set(cookieName, session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24,
    });
    return response;
  } catch (err) {
    return fromError(err);
  }
}