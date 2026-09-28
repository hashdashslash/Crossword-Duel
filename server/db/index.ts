/**
 * The database: Postgres in production (DATABASE_URL, e.g. Render Postgres),
 * or an in-process Postgres (PGlite) for local development and tests.
 * Accounts, history and friends live here; guest games never touch it.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS } from './migrations.js';

type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;

export interface Db {
  query: Query;
  /** Runs `fn` on one connection inside BEGIN/COMMIT (ROLLBACK if it throws). */
  transaction<T>(fn: (query: Query) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

async function postgres(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    // Render's internal URLs don't use SSL; external ones require it.
    ssl: /sslmode=require|render\.com/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  return {
    query: async <T,>(sql: string, params: unknown[] = []) => ({ rows: (await pool.query(sql, params)).rows as T[] }),
    // A pool hands each query to any free connection, so a transaction must hold one client.
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(async <T,>(sql: string, params: unknown[] = []) => ({ rows: (await client.query(sql, params)).rows as T[] }));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** In-process Postgres. `dir` null keeps it in memory (tests). */
export async function embedded(dir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) mkdirSync(dir, { recursive: true });
  const db = dir ? new PGlite(dir) : new PGlite();
  return {
    query: async <T,>(sql: string, params: unknown[] = []) => ({ rows: (await db.query<T>(sql, params)).rows }),
    transaction: (fn) => db.transaction((tx) => fn(async <T,>(sql: string, params: unknown[] = []) => ({ rows: (await tx.query<T>(sql, params)).rows }))),
    close: () => db.close(),
  };
}

/** Applies any migrations not yet run. */
export async function migrate(db: Db) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  for (const [i, sql] of MIGRATIONS.entries()) {
    const version = i + 1;
    if (done.has(version)) continue;
    await db.transaction(async (query) => {
      for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await query(stmt);
      await query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
  }
}

/**
 * Opens the database for the server, or returns null when accounts are off
 * (production without DATABASE_URL). Never throws: a broken database only
 * disables accounts, guest play keeps working.
 */
export async function openDatabase(): Promise<Db | null> {
  try {
    let db: Db;
    if (process.env.DATABASE_URL) db = await postgres(process.env.DATABASE_URL);
    else if (process.env.NODE_ENV === 'production' || process.env.RENDER) return null; // never keep accounts on a wiped disk
    else db = await embedded(join(process.env.DATA_DIR || join(process.cwd(), 'data'), 'pglite'));
    await migrate(db);
    return db;
  } catch (e) {
    console.error('[db] could not open the database; accounts are off:', (e as Error).message);
    return null;
  }
}
