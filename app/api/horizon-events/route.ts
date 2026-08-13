import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db/client';
import { horizonEvents } from '@/server/db/schema';
import { fail, fromError, ok } from '@/server/lib/http';
import { readSession } from '@/server/lib/session';
import { listHorizonEvents, recentHorizonEventsForVault } from '@/server/service/horizon-events.service';

export const dynamic = 'force-dynamic';

const insertSchema = z.object({
  vaultId: z.string().uuid(),
  eventType: z.string().min(1).max(64),
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/),
  label: z.string().max(256).optional().default(''),
  txHash: z.string().regex(/^[a-f0-9]{64}$/i).optional().default(''),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().datetime().optional(),
  vaultId: z.string().uuid().optional(),
  stream: z.string().optional(),
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

  const params = listQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const { vaultId, stream } = params;

  if (stream === '1' && vaultId) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const existing = await recentHorizonEventsForVault(vaultId, 12);
          for (const evt of existing.slice().reverse()) send(evt);
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

  return ok(await listHorizonEvents(params));
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
    return fromError(err);
  }
}

