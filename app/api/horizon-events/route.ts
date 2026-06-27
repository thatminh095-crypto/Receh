import { desc, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/client';
import { horizonEvents } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

// GET /api/horizon-events?vaultId=xxx[&stream=1] — recent vault events, or a live SSE feed.
export async function GET(req: NextRequest) {
  const vaultId = req.nextUrl.searchParams.get('vaultId');
  const stream = req.nextUrl.searchParams.get('stream');

  if (stream === '1' && vaultId) {
    // SSE via a manual ReadableStream (no sdk .stream()).
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
          // ignore DB errors in SSE
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

  return Response.json({ ok: true, data: await query });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows = await db.insert(horizonEvents).values(body).returning();
    return Response.json({ ok: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 400 });
  }
}
