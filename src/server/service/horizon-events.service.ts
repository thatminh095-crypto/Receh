import { and, desc, eq, lt } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { horizonEvents } from '@/server/db/schema';

export async function listHorizonEvents(params: {
  limit?: number;
  cursor?: string;
  vaultId?: string;
} = {}) {
  const { limit = 25, cursor, vaultId } = params;
  const pageSize = limit + 1;
  const conditions = [
    vaultId ? eq(horizonEvents.vaultId, vaultId) : undefined,
    cursor ? lt(horizonEvents.createdAt, new Date(cursor)) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = conditions.length
    ? await db
        .select()
        .from(horizonEvents)
        .where(and(...conditions))
        .orderBy(desc(horizonEvents.createdAt))
        .limit(pageSize)
    : await db
        .select()
        .from(horizonEvents)
        .orderBy(desc(horizonEvents.createdAt))
        .limit(pageSize);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null;
  return { items, nextCursor };
}

export async function recentHorizonEventsForVault(vaultId: string, limit = 12) {
  const rows = await db
    .select()
    .from(horizonEvents)
    .where(eq(horizonEvents.vaultId, vaultId))
    .orderBy(desc(horizonEvents.createdAt))
    .limit(limit);
  return rows;
}
