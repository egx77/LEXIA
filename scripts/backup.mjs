// LEXIA local database backup / verify / restore (FD 08 S6). Stop the server first: the embedded database
// is single-process. Nothing is ever deleted: a restore moves the current database aside, it does not remove it.
//
//   npm run db:backup                     → .data/backups/lexia-<time>.tar.gz + .json manifest
//   npm run db:verify  -- <backup.tar.gz> → checksum, row counts and scoped-access integrity (in memory)
//   npm run db:restore -- <backup.tar.gz> → verify, move current DB aside, restore, verify again
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { createBackup, serverHoldsLock, verifyBackup } from './backup-core.mjs';

const dataDir = resolve(process.env.LEXIA_DATA_DIR || './.data/pg');
const [cmd, arg] = process.argv.slice(2);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const fail = (msg) => { console.error(msg); process.exit(1); };

if (process.env.LEXIA_ENV === 'production') fail('Refusing to run against LEXIA_ENV=production: production backup design is pending (DEV-201/204).');
if (!dataDir.includes('.data')) fail(`Refusing to use ${dataDir}: only databases under a .data folder are handled by this script.`);
const pid = serverHoldsLock(dataDir);
if (pid) fail(`The LEXIA server (process ${pid}) is using the database. Stop it (Ctrl+C in its terminal), then run this again.`);

function printReport(r) {
  for (const s of r.steps) console.log(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.name}${s.detail ? ` — ${[].concat(s.detail).join('; ')}` : ''}`);
  console.log(r.ok ? 'Result: PASS' : 'Result: FAIL');
}

function load(file) {
  if (!file || !existsSync(file)) fail('Give the path of a backup file, e.g. npm run db:verify -- .data/backups/lexia-….tar.gz');
  const mf = file.replace(/\.tar\.gz$/, '.json');
  if (!existsSync(mf)) fail(`Manifest not found: ${mf}`);
  return { bytes: readFileSync(file), manifest: JSON.parse(readFileSync(mf, 'utf8')), mf };
}

if (cmd === 'backup') {
  if (!existsSync(dataDir)) fail(`No database at ${dataDir}.`);
  const out = resolve(arg || join(dirname(dataDir), 'backups'));
  mkdirSync(out, { recursive: true });
  const db = await PGlite.create(dataDir, { extensions: { vector } });
  const { bytes, manifest } = await createBackup(db);
  await db.close();
  const file = join(out, `lexia-${stamp()}.tar.gz`);
  writeFileSync(file, bytes);
  writeFileSync(file.replace(/\.tar\.gz$/, '.json'), JSON.stringify(manifest, null, 2));
  console.log(`Backup written: ${file}\n  ${manifest.bytes} bytes, sha256 ${manifest.sha256.slice(0, 16)}…, ${Object.keys(manifest.counts).length} tables`);
  console.log('Verifying the backup…');
  const r = await verifyBackup(bytes, manifest);
  printReport(r);
  process.exit(r.ok ? 0 : 1);
} else if (cmd === 'verify') {
  const { bytes, manifest } = load(arg);
  const r = await verifyBackup(bytes, manifest);
  printReport(r);
  process.exit(r.ok ? 0 : 1);
} else if (cmd === 'restore') {
  const file = resolve(arg ?? '');
  const { bytes, manifest } = load(file);
  console.log('1/3 Verifying the backup before touching anything…');
  const pre = await verifyBackup(bytes, manifest);
  printReport(pre);
  if (!pre.ok) fail('Backup failed verification; nothing was changed.');
  let movedTo = null;
  if (existsSync(dataDir)) { movedTo = `${dataDir}.before-restore-${stamp()}`; renameSync(dataDir, movedTo); }
  console.log(`2/3 Restoring into ${dataDir}${movedTo ? ` (current database kept at ${movedTo})` : ''}…`);
  console.log('3/3 Verifying the restored database…');
  const post = await verifyBackup(bytes, manifest, dataDir);
  printReport(post);
  const report = { backup: basename(file), moved_aside: movedTo, before: pre, after: post };
  const rp = file.replace(/\.tar\.gz$/, `.restore-report-${stamp()}.json`);
  writeFileSync(rp, JSON.stringify(report, null, 2));
  console.log(`Restore report: ${rp}`);
  if (!post.ok) fail(`Restored database failed verification. Your previous database is untouched at ${movedTo}.`);
  console.log('Restore complete. Start the server again.');
} else {
  fail('Usage: node scripts/backup.mjs backup [outDir] | verify <file> | restore <file>');
}
