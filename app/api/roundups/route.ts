import { fromError, ok } from '@/server/lib/http';
import { listRoundUps } from '@/server/service/roundup.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok(await listRoundUps());
  } catch (err) {
    return fromError(err);
  }
}
