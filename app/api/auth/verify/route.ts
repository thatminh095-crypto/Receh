import { Keypair } from '@stellar/stellar-sdk';
import { eq, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db/client';
import { contributors } from '@/server/db/schema';
import { fail, fromError, ok } from '@/server/lib/http';
import { signSession } from '@/server/lib/session';

export const dynamic = 'force-dynamic';

const schema = z.object({
  publicKey: z.string().min(56),
  nonce: z.string().min(8),
  signedNonce: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const { publicKey, nonce, signedNonce } = schema.parse(await req.json());

    let keypair: Keypair;
    try {
      keypair = Keypair.fromPublicKey(publicKey);
    } catch {
      return fail('INVALID_PUBLIC_KEY', 'publicKey is not a valid Stellar account', 400);
    }

    const message = Buffer.concat([
      Buffer.from('Stellar Signed Message:\n', 'utf8'),
      Buffer.from(nonce, 'utf8'),
    ]);
    const isValid = keypair.verify(message, Buffer.from(signedNonce, 'base64'));
    if (!isValid) {
      return fail('UNAUTHORIZED', 'Invalid signature for challenge nonce', 401);
    }

    const cookieName = process.env.SESSION_COOKIE_NAME ?? 'receh_session';
    const session = await signSession({
      publicKey,
      nonce,
      issuedAt: Date.now(),
    });

    await upsertContributor(publicKey);

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

async function upsertContributor(stellarAddress: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: contributors.id })
        .from(contributors)
        .where(eq(contributors.stellarAddress, stellarAddress))
        .limit(1);
      if (existing[0]) return;

      await tx.execute(sql`LOCK TABLE ${contributors} IN SHARE ROW EXCLUSIVE MODE`);
      const rows = await tx
        .select({ max: sql<number>`COALESCE(MAX(${contributors.muxIndex}), 0)` })
        .from(contributors);
      const maxIndex = Number(rows[0]?.max ?? 0);

      await tx.insert(contributors).values({
        name: stellarAddress.slice(0, 6),
        role: 'shopper',
        cause: '',
        stellarAddress,
        muxIndex: maxIndex + 1,
        totalContributedUsdc: '0.00',
        roundUpCount: 0,
        createdAt: new Date(),
      });
    });
  } catch (err) {
    console.error('[verify] contributor upsert failed', err);
  }
}