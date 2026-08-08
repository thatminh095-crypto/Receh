import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { created, fromError, ok } from '@/server/lib/http';
import { createContributor, listContributors } from '@/server/service/roundup.service';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(2).max(100),
  role: z.enum(['merchant', 'shopper']).default('shopper'),
  cause: z.string().max(200).default(''),
  stellarAddress: z.string().min(56).optional(),
});

export async function GET() {
  try {
    return ok(await listContributors());
  } catch (err) {
    return fromError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = createSchema.parse(await req.json());
    return created(await createContributor(body));
  } catch (err) {
    return fromError(err);
  }
}
