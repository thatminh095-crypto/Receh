import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { created, fromError, ok } from '@/server/lib/http';
import { listRoundUps, recordRoundUp } from '@/server/service/roundup.service';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  contributorId: z.string().uuid(),
  purchaseUsdc: z.string().regex(/^\d+(\.\d{1,7})?$/),
  increment: z.number().positive().optional(),
  txHash: z.string().regex(/^[a-f0-9]{64}$/i, 'txHash must be a 64-char hex Horizon hash'),
});

export async function GET() {
  try {
    return ok(await listRoundUps());
  } catch (err) {
    return fromError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = createSchema.parse(await req.json());
    return created(await recordRoundUp(body));
  } catch (err) {
    return fromError(err);
  }
}
