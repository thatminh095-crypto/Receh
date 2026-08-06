import type { NextRequest } from 'next/server';
import { readSession } from '@/server/lib/session';
import { ok } from '@/server/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cookieName = process.env.SESSION_COOKIE_NAME ?? 'receh_session';
  const token = req.cookies.get(cookieName)?.value ?? '';
  const session = await readSession(token);
  if (!session) return ok({ connected: false });
  return ok({
    connected: true,
    publicKey: session.publicKey,
    issuedAt: session.issuedAt,
    network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet',
  });
}

export async function DELETE() {
  const cookieName = process.env.SESSION_COOKIE_NAME ?? 'receh_session';
  const response = ok({ connected: false });
  response.cookies.delete(cookieName);
  return response;
}