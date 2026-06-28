import { desc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db/client';
import { horizonEvents } from '@/server/db/schema';
import { fail, ok } from '@/server/lib/http';
import { readSession } from '@/server/lib/session';

export const dynamic = 'force-dynamic';

const insertSchema = z.object({
  vaultId: z.string().uuid(),
  eventType: z.string().min(1).max(64),
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/),
  label: z.string().max(256).optional().default(''),
  txHash: z.string().regex(/^[a-f0-9]{64}$/i).optional().default(''),
});

function requireSession(req: NextRequest) {
  const cookieName = process.env.SESSION_COOKIE_NAME ?? 'receh_session';
  const token = req.cookies.get(cookieName)?.value ?? '';
  return readSession(token);
}

// GET /api/horizon-events?vaultId=xxx[&stream=1] — recent vault events, or a live SSE feed.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) {
    return fail('UNAUTHORIZED', 'Connect with Freighter before reading vault events', 401);
  }

  const vaultId = req.nextUrl.searchParams.get('vaultId');
  const stream = req.nextUrl.searchParams.get('stream');

  if (stream === '1' && vaultId) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const existing = await db
            .select()
            .from(horizonEvents)
            .where(eq(horizonEvents.vaultId, vaultId))
            .orderBy(desc(horizonEvents.createdAt))
            .limit(12);
          for (const evt of existing.reverse()) send(evt);
        } catch {

        }

        let running = true;
        let cursor = 'now';
        const pollInterval = setInterval(() => {
          if (!running) return;
          send({
            id: crypto.randomUUID(),
            vaultId,
            eventType: 'heartbeat',
            amount: '0',
            label: 'vault watching Horizon',
            txHash: '',
            createdAt: new Date().toISOString(),
            cursor,
          });
          cursor = String(Date.now());
        }, 5000);

        req.signal.addEventListener('abort', () => {
          running = false;
          clearInterval(pollInterval);
          controller.close();
        });
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  const query = vaultId
    ? db
        .select()
        .from(horizonEvents)
        .where(eq(horizonEvents.vaultId, vaultId))
        .orderBy(desc(horizonEvents.createdAt))
        .limit(25)
    : db.select().from(horizonEvents).orderBy(desc(horizonEvents.createdAt)).limit(25);

  return ok(await query);
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (!session) {
    return fail('UNAUTHORIZED', 'Connect with Freighter before posting vault events', 401);
  }

  try {
    const body = insertSchema.parse(await req.json());
    const rows = await db
      .insert(horizonEvents)
      .values({
        vaultId: body.vaultId,
        eventType: body.eventType,
        amount: body.amount,
        label: body.label,
        txHash: body.txHash,
      })
      .returning();
    return ok(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return fail('INVALID_INPUT', err.issues[0]?.message ?? 'Invalid input', 400);
    }
    return fail('INTERNAL', 'Could not record horizon event', 500);
  }
}
