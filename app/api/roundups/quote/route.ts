import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { fromError, ok } from '@/server/lib/http';
import { quoteRoundUp } from '@/server/service/roundup.service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  contributorId: z.string().uuid(),
  purchaseUsdc: z.string().regex(/^\d+(\.\d{1,7})?$/),
  increment: z.number().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const quote = await quoteRoundUp(body.contributorId, body.purchaseUsdc, body.increment ?? 1);
    return ok(quote);
  } catch (err) {
    return fromError(err);
  }
}
