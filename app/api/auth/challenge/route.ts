import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { fromError, ok } from '@/server/lib/http';

export const dynamic = 'force-dynamic';

const schema = z.object({
  publicKey: z.string().min(56),
});

export async function POST(req: NextRequest) {
  try {
    const { publicKey } = schema.parse(await req.json());
    const nonce = `receh-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return ok({
      publicKey,
      nonce,
      network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet',
      networkPassphrase:
        process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
      issuedAt: new Date().toISOString(),
    });
  } catch (err) {
    return fromError(err);
  }
}