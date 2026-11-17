import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { SCHEMA, SCHEMA_VERSION } from './schema';

/**
 * Database adapter. Prototype uses PGlite (embedded PostgreSQL + pgvector) so the app
 * runs without external infrastructure. DEV-201/DEV-204 remain pending; swapping to a
 * managed PostgreSQL only requires replacing this module's query implementation.
 */
export type Queryable = Pick<PGlite, 'query' | 'exec'> | Transaction;

type G = typeof globalThis & { __lexiaDb?: Promise<PGlite> };
const g = globalThis as G;

async function open(): Promise<PGlite> {
  const dir = process.env.LEXIA_DATA_DIR || './.data/pg';
  if (dir !== 'memory://') {
    mkdirSync(dir, { recursive: true });
    // Single-process database: tell backup/restore scripts this process is using it (removed on exit).
    const lock = `${dir.replace(/[\\/]+$/, '')}.lock`;
    writeFileSync(lock, String(process.pid));
    process.once('exit', () => { try { if (readFileSync(lock, 'utf8') === String(process.pid)) rmSync(lock); } catch { /* already gone */ } });
  }
  const db = dir === 'memory://'
    ? await PGlite.create({ extensions: { vector } })
    : await PGlite.create(dir, { extensions: { vector } });
  await db.exec(SCHEMA);
  await db.query(
    `insert into schema_meta(key, value) values ('schema_version', $1)
     on conflict (key) do update set value = excluded.value`,
    [String(SCHEMA_VERSION)],
  );
  const { ensureBaseline } = await import('./seed');
  await ensureBaseline(db);
  return db;
}

export function getDb(): Promise<PGlite> {
  if (!g.__lexiaDb) {
    g.__lexiaDb = open().catch((e) => {
      g.__lexiaDb = undefined;
      throw e;
    });
  }
  return g.__lexiaDb;
}

/** Test helper: drop the singleton so the next getDb() opens a fresh in-memory DB. */
export async function resetDbForTests() {
  if (g.__lexiaDb) {
    const db = await g.__lexiaDb;
    await db.close();
  }
  g.__lexiaDb = undefined;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = [], t?: Queryable): Promise<T[]> {
  const db = t ?? (await getDb());
  const r = await db.query<T>(sql, params);
  return r.rows;
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = [], t?: Queryable): Promise<T | undefined> {
  return (await q<T>(sql, params, t))[0];
}

export async function tx<T>(fn: (t: Transaction) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}
