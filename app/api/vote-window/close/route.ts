import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { fromError, ok } from '@/server/lib/http';
import { closeAndDisburse } from '@/server/service/grant.service';

export const dynamic = 'force-dynamic';

const schema = z.object({ vaultId: z.string().uuid().optional() });

/** Close the monthly voting window: pick the winner and disburse from the vault on-chain. */
export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json().catch(() => ({})));
    return ok(await closeAndDisburse(body.vaultId));
  } catch (err) {
    return fromError(err);
  }
}
