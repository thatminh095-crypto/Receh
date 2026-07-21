import { fromError, ok } from '@/server/lib/http';
import {
  readAvailable,
  readMemberCount,
  readTotalPool,
} from '@/server/lib/recehPoolContract';
import { stellar } from '@/server/config/stellar';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [total, available, members] = await Promise.all([
      readTotalPool(),
      readAvailable(),
      readMemberCount(),
    ]);
    return ok({
      contractId: stellar.recehPoolContractId,
      network: stellar.network,
      totalPool: total,
      available,
      memberCount: members,
    });
  } catch (err) {
    return fromError(err);
  }
}