import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { contributors } from '@/server/db/schema';
import { fromError, ok } from '@/server/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await ctx.params;
    const rows = await db
      .select()
      .from(contributors)
      .where(eq(contributors.stellarAddress, address));
    if (!rows[0]) {
      return ok({ id: null });
    }
    return ok(rows[0]);
  } catch (err) {
    return fromError(err);
  }
}