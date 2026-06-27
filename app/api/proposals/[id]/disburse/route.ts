import type { NextRequest } from 'next/server';
import { fromError, ok } from '@/server/lib/http';
import { disburseGrant } from '@/server/service/grant.service';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return ok(await disburseGrant(id));
  } catch (err) {
    return fromError(err);
  }
}
