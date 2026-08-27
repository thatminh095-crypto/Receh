import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { fromError, ok } from '@/server/lib/http';
import { submitSignedXlmPayment } from '@/server/lib/xlmPayment';

export const dynamic = 'force-dynamic';

const schema = z.object({ signedTxXdr: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const { signedTxXdr } = schema.parse(await req.json());
    const txHash = await submitSignedXlmPayment(signedTxXdr);
    return ok({ txHash });
  } catch (err) {
    return fromError(err);
  }
}
