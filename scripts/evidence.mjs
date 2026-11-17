// Pilot-readiness evidence report (FD 07 §5, §7, §8; FD 08 S6 exit evidence "QA evidence and owner go/no-go").
// Runs the automated suite (and, when BASE is set, the end-to-end smoke test against that running server),
// then writes evidence/pilot-readiness-<date>-<commit>.md. It reports what was observed; it decides nothing.
//
//   npm run evidence                               → unit/integration suite only
//   BASE=http://localhost:3100 npm run evidence    → plus end-to-end smoke against a running server
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const commit = git('rev-parse', '--short', 'HEAD') || 'no-git';
const dirty = git('status', '--porcelain') ? ' (uncommitted changes present)' : '';
const now = new Date();
const day = now.toLocaleDateString('sv-SE'); // local YYYY-MM-DD

// 1. Unit / integration suite (Vitest JSON reporter)
const out = join(tmpdir(), `lexia-vitest-${process.pid}.json`);
spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', `--outputFile=${out}`], { stdio: 'ignore' });
const vit = JSON.parse(readFileSync(out, 'utf8'));
rmSync(out, { force: true });
const tests = vit.testResults.flatMap((f) => f.assertionResults.map((a) => ({
  file: f.name.replace(/\\/g, '/').split('/tests/')[1] ?? f.name, group: a.ancestorTitles.join(' › '), name: a.title, status: a.status,
  tcs: [...new Set(`${a.ancestorTitles.join(' ')} ${a.title}`.match(/TC-\d{3}/g) ?? [])],
})));
const passed = tests.filter((t) => t.status === 'passed').length;

// 2. Optional end-to-end smoke
let smoke = null;
if (process.env.BASE) {
  const r = spawnSync(process.execPath, [join(root, 'scripts/smoke.mjs')], { env: process.env, encoding: 'utf8' });
  const lines = (r.stdout ?? '').split('\n').filter((l) => /^(PASS|FAIL) /.test(l));
  smoke = { base: process.env.BASE, pass: lines.filter((l) => l.startsWith('PASS')).length, fail: lines.filter((l) => l.startsWith('FAIL')) };
}

// 3. Report
const ok = (b) => (b ? 'PASS' : 'FAIL');
const tcStatus = (tc) => { const t = tests.filter((x) => x.tcs.includes(tc)); return t.length ? ok(t.every((x) => x.status === 'passed')) : '—'; };
const group = (prefix) => tests.filter((t) => t.group.startsWith(prefix));
const allOk = (list) => list.length > 0 && list.every((t) => t.status === 'passed');
const tcs = [...new Set(tests.flatMap((t) => t.tcs))].sort();
// FD 07 §2 (Rev 03) defines TC-001 to TC-038; list the ones with no automated test so the gap is visible.
const uncovered = Array.from({ length: 38 }, (_, i) => `TC-${String(i + 1).padStart(3, '0')}`).filter((tc) => !tcs.includes(tc));

const md = `# LEXIA pilot-readiness evidence — ${day}

> **Status of this evidence.** Local prototype, synthetic fictional fixtures only (FD 07 §6). This is *not* pilot or release evidence (FD 07 §1), and it approves nothing: the go/no-go decision belongs to the product owner (FD 08 S6).

## 1. Build and environment (FD 07 §7)

| Item | Value |
|---|---|
| Build | commit \`${commit}\`${dirty} |
| Generated | ${now.toISOString()} |
| Runtime | Node ${process.version}, ${process.platform} |
| Database | PGlite (embedded PostgreSQL + pgvector), in-memory for the suite |
| AI adapter | \`local-extractive-v1\` (deterministic; no external provider, DEV-206/207 pending) |
| Retrieval / embeddings | hybrid full-text + \`local-hash-v1\` placeholder vectors |
| Fixtures | FD 07 §6 synthetic set (Firm A, Firm B, platform QA tenant) |

## 2. Automated results

- **Unit / integration suite:** ${passed} of ${tests.length} passed — ${ok(passed === tests.length)}
${smoke ? `- **End-to-end smoke** (${smoke.base}): ${smoke.pass} of ${smoke.pass + smoke.fail.length} checks passed — ${ok(!smoke.fail.length)}${smoke.fail.length ? '\n' + smoke.fail.map((l) => `  - ${l}`).join('\n') : ''}` : '- **End-to-end smoke:** not run in this report (set `BASE` to a running server to include it).'}

### By FD 07 test case

| Test case | Result |
|---|---|
${tcs.map((tc) => `| ${tc} | ${tcStatus(tc)} |`).join('\n')}

${uncovered.length ? `**No automated test in this build:** ${uncovered.join(', ')}. These need manual or pilot evidence (FD 07 §2 says what each one checks).` : 'Every FD 07 test case has at least one automated test.'}

### S6 hardening checks

| Check | Result |
|---|---|
| Sign-in throttling, no account enumeration, no secrets in audit | ${ok(allOk(group('S6 — sign-in')))} |
| Broken-object authorization sweep (other firm, direct IDs) | ${ok(allOk(group('S6 — broken-object')))} |
| FR-036 blinded recognition review (TC-030 mechanism) | ${ok(allOk(group('S6 — FR-036')))} |
| Backup → restore: checksum, row counts, scoped-access integrity, append-only audit | ${ok(allOk(group('S6 — backup')))} |
${smoke ? `| Accessibility basics on key screens (lang, one h1, skip link, labelled controls) | ${ok(!smoke.fail.some((l) => l.includes('a11y')))} |\n` : ''}
<details><summary>All ${tests.length} tests</summary>

| File | Test | Result |
|---|---|---|
${tests.map((t) => `| ${t.file} | ${t.group} › ${t.name.replace(/\|/g, '\\|')} | ${t.status} |`).join('\n')}

</details>

## 3. Quality gates (FD 07 §5)

| Gate | Prototype evidence | Still required before a pilot with real matters |
|---|---|---|
| Source authenticity | Verified label only on exact authorized passages (TC-010/014: ${tcStatus('TC-010')}) | Real rights-cleared sources (DEV-101); lawyer review log |
| Privacy and isolation | Isolation suites + S6 sweep above | Independent security review; threat model |
| Personalization | Blind-review tool built; results counted on the scorecard | Consenting pilot lawyers to produce the actual measurements |
| Legal correctness | No fabricated citation can be labelled verified (TC-014) | Lawyer-reviewed error register on representative cases |
| Continuity | AI outage and exhausted quota keep work usable (TC-021: ${tcStatus('TC-021')}) | Outage drill on the pilot environment |
| Accessibility | Automated basics${smoke ? ' (smoke)' : ''} | Full audit and observed user sessions |
| Recovery | Backup/restore verified with integrity report | Recovery targets (pending); restore drill on pilot hosting (DEV-201/204) |
| Cost | Units metered per run; quotas enforced; per-approved-draft figure on scorecard | Approved cost model and prices |

Numerical targets are deliberately absent (DEV-105, DEV-209).

## 4. Before-pilot checklist (FD 07 §8)

| Item | Status |
|---|---|
| Representative synthetic test results | This report |
| Legal source rights (DEV-101) | **Pending — owner** |
| Policies (terms, privacy, AI disclosure, DNA notice) reviewed by a lawyer | **Pending — owner** (currently \`0.1-draft\`) |
| Consent language (pilot participation, DNA, blind review) reviewed | **Pending — owner** |
| Support and incident process | **Pending — owner** |
| Participant agreement | **Pending — owner** |
| AI provider and data terms, if the pilot uses a real model (DEV-206/207) | **Pending — owner** |
| Pilot hosting, MFA and email delivery (DEV-201/204/205) | **Pending — technical lead** |

## 5. Owner go/no-go

FD 08 §6 allows fictional cases for initial security and correctness checks; live confidential matters need the rights, privacy and participant items above.

- Pilot with **fictional cases only**: Go / No-go: ____
- Pilot with **real client matters**: Go / No-go: ____ (not possible until every section 4 item is done)

Decided by: ____  Date: ____
`;

mkdirSync(join(root, 'evidence'), { recursive: true });
const file = join(root, 'evidence', `pilot-readiness-${day}-${commit}.md`);
writeFileSync(file, md);
console.log(`Evidence report: ${file}`);
console.log(`Suite ${passed}/${tests.length}${smoke ? `, smoke ${smoke.pass}/${smoke.pass + smoke.fail.length}` : ''}`);
process.exit(passed === tests.length && (!smoke || !smoke.fail.length) ? 0 : 1);
