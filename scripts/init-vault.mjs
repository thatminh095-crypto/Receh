import 'dotenv/config';
import { createVault, getVault } from '../src/server/service/vault.service';
import { db } from '../src/server/db/client';

const vaultAddress =
  process.env.VAULT_ADDRESS ?? 'GBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIE47';
const vaultContract = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const existing = await getVault().catch(() => null);
if (existing) {
  console.log('vault already exists, skipping');
  process.exit(0);
}

const vault = await createVault({
  name: 'Receh Community Vault',
  vaultAddress,
  vaultContractId: vaultContract,
  principalUsdc: '0',
  accruedYieldUsdc: '0',
  apyPercent: '8.50',
  createdAt: new Date(Date.now() - 31 * 86400 * 1000),
  updatedAt: new Date(),
});
console.log('vault created', vault.id);

await db.$client?.end?.();
