import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { fromError, ok } from '@/server/lib/http';
import { stellar } from '@/server/config/stellar';
import { buildChangeTrustTx } from '@/server/lib/trustline';

export const dynamic = 'force-dynamic';

const schema = z.object({ publicKey: z.string() });

export async function POST(req: NextRequest) {
  try {
    const { publicKey } = schema.parse(await req.json());
    const xdr = await buildChangeTrustTx(publicKey, {
      code: stellar.usdcAssetCode,
      issuer: stellar.usdcIssuer,
    });
    return ok({ xdr, networkPassphrase: stellar.passphrase });
  } catch (err) {
    return fromError(err);
  }
}