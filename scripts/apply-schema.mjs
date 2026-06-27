import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DRIZZLE_DATABASE_URL;
const sqlPath = process.argv[2] ?? './drizzle/0000_little_roland_deschain.sql';

const sql = readFileSync(sqlPath, 'utf-8');
const client = new pg.Client({ connectionString: url });
await client.connect();

const statements = sql
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean);

for (const stmt of statements) {
  try {
    await client.query(stmt);
    console.log('OK:', stmt.slice(0, 60).replace(/\n/g, ' ') + '...');
  } catch (err) {
    console.error('FAIL:', stmt.slice(0, 60));
    console.error('  ', err.message);
    process.exitCode = 1;
  }
}
await client.end();
console.log('done');