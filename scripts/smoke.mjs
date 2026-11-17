// End-to-end smoke test driving the real HTML forms (no-JS server action posts) of a running LEXIA server.
const B = process.env.BASE ?? 'http://localhost:3100';
let cookie = '';
const log = (...a) => console.log(...a);
let failures = 0;
const check = (ok, msg) => { log(ok ? 'PASS' : 'FAIL', msg); if (!ok) failures++; };

async function get(path) {
  const r = await fetch(B + path, { headers: { cookie }, redirect: 'manual' });
  return { status: r.status, loc: r.headers.get('location'), html: await r.text(), r };
}
function forms(html) {
  return html.split('<form').slice(1).map((f) => f.split('</form>')[0]);
}
function hiddenFields(f) {
  const out = [];
  for (const m of f.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const n = /name="([^"]*)"/.exec(m[0]); const v = /value="([^"]*)"/.exec(m[0]);
    if (n) out.push([n[1], (v?.[1] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')]);
  }
  return out;
}
/** Submit the form on `page` whose HTML contains `marker`, with extra fields. Returns redirect location. */
async function submit(page, marker, fields, nth = 0) {
  const { html } = await get(page);
  const f = forms(html).filter((x) => x.includes(marker))[nth];
  if (!f) throw new Error(`form with ${marker} not found on ${page}`);
  const fd = new FormData();
  for (const [k, v] of hiddenFields(f)) fd.append(k, v);
  for (const [k, v] of fields) fd.append(k, v);
  const r = await fetch(B + page, { method: 'POST', body: fd, headers: { cookie }, redirect: 'manual' });
  const sc = r.headers.getSetCookie?.() ?? [];
  for (const c of sc) { const kv = c.split(';')[0]; if (kv.startsWith('lexia_session=')) cookie = kv; }
  const loc = r.headers.get('location') ?? '';
  return decodeURIComponent(loc.replace(B, '').replace(/\+/g, ' '));
}
async function signIn(email) {
  cookie = '';
  const loc = await submit('/signin', 'name="password"', [['email', email], ['password', 'Lexia-Pilot-2026!'], ['next', '/app']]);
  if ((await get('/app')).loc?.includes('/onboarding')) {
    const { html } = await get('/onboarding');
    const ids = [...html.matchAll(/name="policy" value="([^"]*)"/g)].map((m) => m[1]);
    await submit('/onboarding', 'name="policy"', [...ids.map((i) => ['policy', i]), ['plan', 'pilot']]);
  }
  return loc;
}

await signIn('atty.reyes@lexia.test');
const matters = await (await fetch(B + '/api/v1/matters', { headers: { cookie } })).json();
const MID = matters.matters[0].id;
check(matters.matters.length >= 1, `Reyes sees ${matters.matters.length} matter(s)`);

// ---- Work Desk (task-oriented workspace) ----
{
  let p = await get('/app');
  check(p.status === 200 && p.html.includes('What would you like to do today?'), 'Work Desk home renders');
  check(p.html.includes('Your attention is needed'), 'attention strip renders');
  for (const v of ['recent', 'all', 'client', 'matter']) check((await get(`/app/continue?view=${v}`)).status === 200, `continue view=${v}`);
  for (const c of ['write', 'research', 'analyze', 'review', 'prepare', 'matter', 'notarial', 'client', 'practice', 'learn']) {
    check((await get(`/app/start?cat=${c}`)).status === 200, `catalog cat=${c}`);
  }
  p = await get(`/app/start?q=${encodeURIComponent('Prepare a demand letter for my client regarding an unpaid loan')}`);
  check(p.html.includes('/app/start/write-letter?q='), 'intent → Write a letter offered (not started)');
  p = await get(`/app/start/write-letter?q=${encodeURIComponent('demand letter for Santos unpaid loan')}`);
  check(/value="demand_letter"[^>]*checked|checked[^>]*value="demand_letter"/.test(p.html), 'demand letter pre-selected from instruction');
  p = await get(`/app/start/write-pleading?q=${encodeURIComponent('Draft a motion for reconsideration')}`);
  check(p.html.includes('template is not available yet'), 'unbuilt motion template reported honestly');
  p = await get('/app/start/find-law');
  check(p.status === 307 && (p.loc ?? '').includes('/app/research?types='), `ready non-guided task redirects to its tool (${p.loc})`);
  check((await get('/app/start/no-such-task')).status === 404, 'unknown task → 404');

  let l = await submit('/app/start/write-pleading', 'name="matterMode"', [['docType', 'answer'], ['matterMode', 'existing'], ['matter', MID],
    ['facts', 'Defendant received the written demand on 5 March 2026 (fictional).'], ['saveFacts', 'on'], ['dnaWriting', 'on']]);
  check(/\/app\/drafts\/[0-9a-f-]{36}\?ok=/.test(l), `guided pleading → draft (${l.slice(0, 120)})`);
  const gid = l.split('/').pop().split('?')[0];
  check((await get(`/app/drafts/${gid}`)).html.includes('Writing DNA'), 'guided draft applied Writing DNA');
  p = await get(`/app/matters/${MID}?tab=facts`);
  check(p.html.includes('5 March 2026 (fictional)'), 'instruction saved as matter fact');

  l = await submit('/app/start/write-letter', 'name="matterMode"', [['docType', 'demand_letter'], ['matterMode', 'new'], ['client', 'Lorna Aquino (fictional)'],
    ['mtitle', 'Aquino — collection of unpaid loan (fictional)'], ['practice', 'Civil Litigation'], ['issues', 'Whether the debtor is in delay after demand?']]);
  check(/\/app\/drafts\/[0-9a-f-]{36}/.test(l), `guided letter with new matter → draft (${l.slice(0, 120)})`);
  p = await get('/app/continue?view=client');
  check(p.html.includes('Lorna Aquino (fictional)'), 'new client appears in Continue Work by client');
  p = await get(`/app/start?q=${encodeURIComponent('continue my demand letter for Aquino')}`);
  check(p.html.includes('Continue existing work?') && p.html.includes('/app/drafts/'), 'continue intent offers the existing draft');

  check((await get('/app/start/set-deadline')).html.includes('Step 1 of 2'), 'set deadline step 1');
  l = await submit(`/app/start/set-deadline?matter=${MID}`, 'name="evidence"', [['title', 'File pre-trial brief (fictional)'], ['due', '2026-12-10T09:00'], ['verified', 'on'], ['evidence', 'Order dated 1 Dec 2026 (fictional)']]);
  check(l.includes('ok='), `set deadline → ${l}`);
}

// J-001 research
let loc = await submit(`/app/research?matter=${MID}`, 'name="question"', [
  ['question', 'Whether Bayani Trading Corp. incurred delay in delivery after written demand? Whether Marina Santos may recover damages for the delay?'],
  ['matter', MID], ['scope', 'core'], ['scope', 'firm'], ['scope', 'personal'], ['scope', 'matter']]);
check(/\/app\/research\/[0-9a-f-]{36}/.test(loc), `research redirect ${loc}`);
const RID = loc.split('/').pop().split('?')[0];
let page = await get(`/app/research/${RID}`);
const v = (page.html.match(/✓ Verified source/g) ?? []).length, nc = (page.html.match(/Needs checking/g) ?? []).length;
check(v > 0, `research shows ${v} verified badges, ${nc} needs-checking mentions`);
check(!/ignore (all )?previous instructions/i.test(page.html.split('Issue analysis')[1]?.split('Limitations')[0] ?? ''), 'injected instruction not in analysis');

// Memo from research (combined DNA)
loc = await submit(`/app/research/${RID}`, 'name="docType"', [['mode', 'combined']]);
check(/\/app\/drafts\/[0-9a-f-]{36}/.test(loc), `memo redirect ${loc}`);
const DID = loc.split('/').pop().split('?')[0];
page = await get(`/app/drafts/${DID}`);
check(page.status === 200 && page.html.includes('Save new version'), 'draft editor renders');
for (const view of ['compare', 'diff']) check((await get(`/app/drafts/${DID}?view=${view}`)).status === 200, `draft view=${view}`);
let r = await fetch(`${B}/app/drafts/${DID}/export`, { headers: { cookie } });
let buf = new Uint8Array(await r.arrayBuffer());
check(r.status === 200 && buf[0] === 0x50 && buf[1] === 0x4b, `docx export ${r.status} ${buf.length}B (zip)`);

// Edit -> new version, then approve with ack
const firstBlock = /name="(b:[^"]+)"/.exec(page.html)[1];
loc = await submit(`/app/drafts/${DID}`, 'Save new version', [[firstBlock, 'MEMORANDUM (edited by counsel)'], ['note', 'smoke edit']]);
check(loc.includes('ok='), `save version -> ${loc}`);
page = await get(`/app/drafts/${DID}`);
const ver = /version (\d+)<!-- --> \(|version <!-- -->(\d+)/.exec(page.html);
loc = await submit(`/app/drafts/${DID}`, 'name="op" value="approve"', [['ack', 'on']]);
check(loc.includes('ok='), `approve -> ${loc}`);
page = await get(`/app/drafts/${DID}`);
check(page.html.includes('Lawyer approved'), 'approval banner visible');
r = await fetch(`${B}/app/drafts/${DID}/export`, { headers: { cookie } });
check(r.status === 200, 'approved docx export');

// DNA feedback proposal
loc = await submit(`/app/drafts/${DID}`, 'Propose Lawyer DNA', []);
log('  propose feedback ->', loc);

// Tasks: confirm a suggestion
page = await get('/app/tasks');
if (page.html.includes('name="due"')) {
  loc = await submit('/app/tasks', 'name="due"', [['due', '2026-12-01T10:00'], ['evidence', 'Checked order dated 2026-11-10 (fictional)']]);
  check(loc.includes('ok='), `confirm deadline -> ${loc}`);
}
{ const th = forms((await get("/app/tasks")).html).find((f) => f.includes("Save today")) ?? ""; console.log("  plan form inputs:", (th.match(/<input[^>]*name="task"[^>]*>/g) ?? []).slice(0, 2)); const ids = [...th.matchAll(/name="task"[^>]*value="([^"]*)"/g)].map((m) => ["task", m[1]]); loc = await submit("/app/tasks", "Save today", ids.slice(0, 3)); }
check(loc.includes('ok='), `save plan -> ${loc}`);

// API errors and isolation
r = await fetch(`${B}/api/v1/matters/00000000-0000-0000-0000-000000000000/documents`, { headers: { cookie } });
check(r.status === 403 || r.status === 404, `foreign matter docs -> ${r.status} ${await r.text()}`);
r = await fetch(`${B}/api/v1/usage`); check(r.status === 401, `unauthenticated usage -> ${r.status}`);
r = await fetch(`${B}/api/v1/usage`, { headers: { cookie } }); check(r.status === 200, `usage -> ${r.status}`);

// Assistant cannot approve; tenant B cannot see tenant A matter
await signIn('assistant.dela@lexia.test');
page = await get(`/app/drafts/${DID}`);
check(!page.html.includes('name="op" value="approve"'), 'assistant has no approve form');
r = await fetch(`${B}/api/v1/drafts/${DID}/review`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve', version: 2, acknowledge_open_items: true }) });
check(r.status === 403, `assistant API approve -> ${r.status}`);
await signIn('atty.lim@lexia.test');
page = await get(`/app/matters/${MID}`);
check(!page.html.includes('Marina Santos'), `tenant B matter page hides client (${page.status})`);
r = await fetch(`${B}/api/v1/matters/${MID}/documents`, { headers: { cookie } });
check(r.status === 403 || r.status === 404, `tenant B API -> ${r.status}`);

// Admin: simulated outage -> research falls back
await signIn('atty.reyes@lexia.test');
loc = await submit('/app/account', 'name="simulation"', [['simulation', 'outage']]);
loc = await submit('/app/research', 'name="question"', [['question', 'Whether delay requires demand?'], ['scope', 'core']]);
page = await get(loc.split('?')[0]);
check(page.html.includes('AI analysis unavailable'), 'outage -> keyword fallback notice');
await submit('/app/account', 'name="simulation"', [['simulation', 'none']]);

// ---- S6 pilot hardening ----
{
  // FR-036 blinded recognition review of the guided Writing-DNA draft created above
  let p = await get('/app/dna?tab=blind');
  check(p.status === 200 && p.html.includes('Start blind review'), 'blind review list offers a DNA draft');
  let l = await submit('/app/dna?tab=blind', 'name="draft"', []);
  check(/\/app\/dna\/review\/[0-9a-f-]{36}$/.test(l), `start blind review → ${l}`);
  p = await get(l);
  const docs = p.html.split('Version A')[1]?.split('1. Which version')[0] ?? '';
  check(p.status === 200 && docs.includes('Version B') && !/dna|neutral|personaliz/i.test(docs), 'review page shows A/B with no label giving the answer away');
  const noConsent = await submit(l, 'name="voice"', [['voice', 'a'], ['approach', 'b'], ['legal', 'none'], ['effort', 'light']]);
  check(noConsent.includes('error='), 'review without consent is refused');
  const done = await submit(l, 'name="voice"', [['voice', 'a'], ['approach', 'b'], ['legal', 'none'], ['effort', 'light'], ['consent', 'yes']]);
  check(/ok=.*Lawyer DNA was [AB]/.test(done), `review recorded and answer revealed (${done.slice(0, 110)})`);
  const csv = await get('/app/account/scorecard-export');
  check(csv.status === 200 && csv.r.headers.get('content-type')?.includes('text/csv') && /"blind_review\.completed","[1-9]\d*"/.test(csv.html), 'scorecard CSV export includes the review count');

  // Accessibility basics on key screens (FD 02 §6): page language, one h1, skip link, every control labelled
  const pages = ['/app', '/app/start?cat=write', '/app/start/write-pleading', '/app/continue', '/app/research', '/app/tasks', '/app/dna?tab=consent', '/app/account?tab=scorecard'];
  for (const path of pages) {
    const { html } = await get(path);
    const problems = [];
    if (!/<html[^>]*\blang="/.test(html)) problems.push('no lang');
    if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) problems.push(`${(html.match(/<h1[\s>]/g) ?? []).length} h1`);
    if (!html.includes('class="skip"')) problems.push('no skip link');
    for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
      const tag = m[0];
      if (/type="(hidden|submit|button)"/.test(tag)) continue;
      const id = /\bid="([^"]+)"/.exec(tag)?.[1];
      const before = html.slice(0, m.index);
      const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
      if (!wrapped && !/aria-label(ledby)?="/.test(tag) && !(id && html.includes(`for="${id}"`))) problems.push(`unlabelled ${tag.slice(0, 60)}`);
    }
    check(problems.length === 0, `a11y basics ${path}${problems.length ? ' — ' + problems.slice(0, 3).join(' | ') : ''}`);
  }

  // Sign-in throttling through the real form (unregistered email, so no fixture account is locked)
  cookie = '';
  let last = '';
  for (let i = 0; i < 5; i++) last = await submit('/signin', 'name="password"', [['email', 'nobody@example.test'], ['password', 'wrong-password-123'], ['next', '/app']]);
  check(last.includes('Too many sign-in attempts'), `5 wrong passwords → locked (${last.slice(0, 80)})`);
}

log(failures ? `\n${failures} FAILURE(S)` : '\nALL SMOKE CHECKS PASSED');
process.exit(failures ? 1 : 0);
