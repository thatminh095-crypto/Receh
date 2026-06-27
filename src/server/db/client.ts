import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '@/server/config/env';
import * as schema from '@/server/db/schema';

const globalForDb = globalThis as unknown as {
  pgPool: Pool | undefined;
};

const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: env.DRIZZLE_DATABASE_URL,
    max: 10,
  });

if (env.NODE_ENV !== 'production') {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema });
export type Database = typeof db;
