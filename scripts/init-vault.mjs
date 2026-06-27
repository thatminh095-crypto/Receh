import pg from 'pg';

const url = process.env.DRIZZLE_DATABASE_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();

const existing = await client.query('SELECT id FROM vault_pool LIMIT 1');
if (existing.rows.length === 0) {
  const vaultAddress =
    process.env.VAULT_ADDRESS ?? 'GBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIE47';
  const vaultContract = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
  await client.query(
    `INSERT INTO vault_pool
      (name, vault_address, vault_contract_id, principal_usdc, accrued_yield_usdc, apy_percent, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - interval '31 days', now())`,
    [
      'Receh Community Vault',
      vaultAddress,
      vaultContract,
      '0',
      '0',
      '8.50',
    ],
  );
  console.log('vault created');
} else {
  console.log('vault already exists, skipping');
}

await client.end();