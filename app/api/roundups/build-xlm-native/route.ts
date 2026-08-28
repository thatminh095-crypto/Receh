import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { stellar } from '@/server/config/stellar';
import { fromError, ok } from '@/server/lib/http';
import { buildNativeXlmRoundUp } from '@/server/service/roundup.service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  contributorPublicKey: z.string().length(56).startsWith('G'),
  contributorId: z.string().uuid(),
  purchaseXlm: z.string().regex(/^\d+(\.\d{1,7})?$/),
  increment: z.number().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const payment = await buildNativeXlmRoundUp(
      body.contributorPublicKey,
      body.contributorId,
      body.purchaseXlm,
      body.increment ?? 0.001,
    );
    return ok({ ...payment, networkPassphrase: stellar.passphrase });
  } catch (err) {
    return fromError(err);
  }
}
