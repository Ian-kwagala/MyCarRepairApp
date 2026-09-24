import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { config } from './config';

// Timestamps are stored as UTC wall-clock time (TIMESTAMP columns, like the web schema) and returned as
// ISO-8601 with "Z" (§5.1). Parse TIMESTAMP and DATE deterministically, independent of the host timezone.
pg.types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`)); // timestamp
pg.types.setTypeParser(1082, (v) => v); // date → 'YYYY-MM-DD'
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric/decimal → number (UGX, lat/lng)

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  // Sessions run in UTC so now() → TIMESTAMP columns hold UTC wall-clock time (set at connection startup).
  options: '-c TimeZone=UTC',
});

export type Db = Pick<pg.PoolClient, 'query'>;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return (await pool.query<T>(text, params)).rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return (await pool.query<T>(text, params)).rows[0] as T | undefined;
}

/** Runs fn in a transaction (BEGIN … COMMIT / ROLLBACK). */
export async function tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const sql = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
  await pool.query(sql);
}
