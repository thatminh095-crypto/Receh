import { fromError, ok } from '@/server/lib/http';
import { getVaultStats } from '@/server/service/vault.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = await getVaultStats();
    return ok(stats);
  } catch (err) {
    return fromError(err);
  }
}
