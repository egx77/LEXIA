// Backup, restore and integrity verification for the embedded database (FD 07 §5 "Recovery" gate,
// FD 08 S6). Plain JavaScript so both the CLI (scripts/backup.mjs) and the Vitest suite can import it.
// Recovery time and backup frequency targets are NOT set here: they are pending (FD 02 §6, DEV-209).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Row count of every table in the public schema. */
export async function tableCounts(db) {
  const { rows } = await db.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const out = {};
  for (const { table_name } of rows) out[table_name] = Number((await db.query(`select count(*)::int as n from "${table_name}"`)).rows[0].n);
  return out;
}

/**
 * Scoped-access integrity: every row that names both a tenant and a matter must belong to that matter's tenant,
 * every matter assignment must point to a member of the matter's firm, and the audit log must still be append-only.
 * Each check returns the number of violations; 0 everywhere = pass.
 */
export async function integrityChecks(db) {
  const checks = [];
  const { rows: scoped } = await db.query(
    `select c1.table_name from information_schema.columns c1 join information_schema.columns c2
       on c2.table_name = c1.table_name and c2.table_schema = c1.table_schema and c2.column_name = 'matter_id'
      where c1.table_schema = 'public' and c1.column_name = 'tenant_id' and c1.table_name <> 'matters' order by 1`);
  for (const { table_name } of scoped) {
    const n = (await db.query(`select count(*)::int as n from "${table_name}" x join matters m on m.id = x.matter_id where x.tenant_id <> m.tenant_id`)).rows[0].n;
    checks.push({ check: `${table_name}: tenant matches its matter's tenant`, violations: Number(n) });
  }
  const assign = (await db.query(
    `select count(*)::int as n from matter_assignments a join matters m on m.id = a.matter_id
      where not exists (select 1 from memberships ms where ms.user_id = a.user_id and ms.tenant_id = m.tenant_id)`)).rows[0].n;
  checks.push({ check: 'matter_assignments: assignee is a member of the matter firm', violations: Number(assign) });
  const drafts = (await db.query(
    `select count(*)::int as n from draft_versions v left join drafts d on d.id = v.draft_id where d.id is null`)).rows[0].n;
  checks.push({ check: 'draft_versions: every version belongs to a draft', violations: Number(drafts) });
  const trig = (await db.query(`select count(*)::int as n from pg_trigger where tgname = 'audit_no_update' and not tgisinternal`)).rows[0].n;
  checks.push({ check: 'audit_events: append-only trigger present', violations: Number(trig) === 1 ? 0 : 1 });
  let appendOnly = 0;
  try { await db.exec(`begin; update audit_events set action = action where id = (select min(id) from audit_events); rollback;`); appendOnly = 1; }
  catch { await db.exec('rollback').catch(() => {}); }
  checks.push({ check: 'audit_events: update is refused', violations: appendOnly });
  return checks;
}

/** Writes a gzip tarball of the data directory plus a manifest (hash, schema version, row counts). */
export async function createBackup(db) {
  const blob = await db.dumpDataDir('gzip');
  const bytes = Buffer.from(await blob.arrayBuffer());
  const schema = (await db.query(`select value from schema_meta where key = 'schema_version'`)).rows[0]?.value ?? null;
  const manifest = { format: 'lexia-pglite-backup-1', created_at: new Date().toISOString(), schema_version: schema,
    sha256: sha256(bytes), bytes: bytes.length, counts: await tableCounts(db) };
  return { bytes, manifest };
}

export async function openFromBackup(bytes, dataDir) {
  const loadDataDir = new Blob([bytes]);
  return dataDir ? PGlite.create(dataDir, { loadDataDir, extensions: { vector } }) : PGlite.create({ loadDataDir, extensions: { vector } });
}

/** Verifies a backup without touching the live database: checksum, row counts, scoped-access integrity. */
export async function verifyBackup(bytes, manifest, dataDir) {
  const report = { verified_at: new Date().toISOString(), backup_created_at: manifest.created_at, steps: [] };
  const step = (name, ok, detail) => report.steps.push({ name, ok, ...(detail ? { detail } : {}) });
  step('checksum matches manifest', sha256(bytes) === manifest.sha256);
  const db = await openFromBackup(bytes, dataDir);
  try {
    const counts = await tableCounts(db);
    const diff = Object.keys({ ...manifest.counts, ...counts }).filter((t) => manifest.counts[t] !== counts[t]);
    step('row counts match manifest', diff.length === 0, diff.length ? diff.map((t) => `${t}: ${manifest.counts[t]} → ${counts[t]}`) : undefined);
    const checks = await integrityChecks(db);
    for (const c of checks) step(c.check, c.violations === 0, c.violations ? `${c.violations} violation(s)` : undefined);
  } finally { await db.close(); }
  report.ok = report.steps.every((s) => s.ok);
  return report;
}

/** The running server writes `<dataDir>.lock` with its pid; a backup or restore must not run beside it. */
export function serverHoldsLock(dataDir) {
  const lock = `${dataDir}.lock`;
  if (!existsSync(lock)) return null;
  const pid = Number(readFileSync(lock, 'utf8'));
  if (!pid || pid === process.pid) return null;
  try { process.kill(pid, 0); return pid; } catch { return null; } // stale lock from a stopped server
}
