import { selectPlanAction, simulationAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Badge, Empty, Flash, fmtDateTime, PageHead, Tabs } from '@/components/ui';
import { simulationAllowed, usageSummary } from '@/lib/ai/gateway';
import { listAudit } from '@/lib/audit';
import { can, requirePerm } from '@/lib/authz';
import { entitlement, listPlans } from '@/lib/policies';
import { scorecard } from '@/lib/scorecard';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'Account & Usage' };

export default async function Account({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  await requirePerm(ctx, 'view_billing');
  const tab = sp.tab ?? 'usage';
  const isAdmin = can(ctx, 'view_audit');
  const tabs: [string, string][] = [['usage', 'Plan & usage']];
  if (isAdmin) tabs.push(['scorecard', 'Quality scorecard'], ['audit', 'Audit log']);
  return (
    <>
      <PageHead title="Account & Usage" sub="Plan placeholders, AI usage and availability. This view never shows privileged matter contents." />
      <Flash sp={sp} />
      <Tabs base="/app/account" current={tab} tabs={tabs} />
      {tab === 'usage' && <Usage />}
      {tab === 'scorecard' && isAdmin && <Score />}
      {tab === 'audit' && isAdmin && <Audit />}
    </>
  );

  async function Usage() {
    const [u, ent, plans] = await Promise.all([usageSummary(ctx), entitlement(ctx.tenantId), listPlans()]);
    return (
      <>
        <div className="grid3">
          <div className="card"><h3>AI availability</h3><p className="kpi">{u.status.available ? 'Available' : 'Paused'}</p><p className="muted">{u.status.reason ?? 'Adapter: local-extractive-v1 (no external provider selected).'}</p></div>
          <div className="card"><h3>Usage this period</h3><p className="kpi">{u.status.used} / {u.status.quota}</p><p className="muted">Placeholder units since {ent?.period_start}. Caps are not approved values.</p></div>
          <div className="card"><h3>Plan</h3><p className="kpi">{ent?.plan_name ?? '—'}</p><p className="muted">Payment: {ent?.payment_state === 'not_required' ? 'not required (pilot)' : 'pending approved billing provider — nothing charged'}</p></div>
        </div>
        {can(ctx, 'manage_members') && (
          <form action={selectPlanAction} className="card">
            <h2>Change placeholder plan</h2>
            <div className="row">
              <div className="field"><label htmlFor="plan">Plan</label><select id="plan" name="plan" defaultValue={ent?.plan_code}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name} — price not set</option>)}</select></div>
              <Submit className="btn">Update</Submit>
            </div>
          </form>
        )}
        {can(ctx, 'simulate_ai') && simulationAllowed() && (
          <div className="card">
            <h2>Test environment: simulate AI conditions</h2>
            <p className="muted">For pilot/QA only (FD 07 §6 fixtures). Disabled when LEXIA_ENV=production.</p>
            <form action={simulationAction} className="row">
              <div className="field"><label htmlFor="simulation">Condition</label>
                <select id="simulation" name="simulation" defaultValue={u.status.simulation}>
                  <option value="none">Normal</option><option value="outage">Provider outage</option><option value="timeout">Timeout after first step</option>
                  <option value="fabricated_citation">Model returns a fabricated citation</option><option value="malicious_instruction">Malicious instruction (refused)</option>
                </select></div>
              <Submit className="btn">Apply</Submit>
            </form>
            <form action={simulationAction} className="row">
              <div className="field"><label htmlFor="used">Set units used (e.g. {Math.max(0, u.status.quota - 2)} to exhaust mid-draft)</label><input id="used" name="used" type="text" inputMode="numeric" defaultValue={u.status.used} /></div>
              <Submit className="btn">Set usage</Submit>
            </form>
          </div>
        )}
        <div className="card table-wrap">
          <h2>Recent AI runs</h2>
          {u.runs.length ? <table><thead><tr><th>When</th><th>User</th><th>Kind</th><th>Status</th><th>Units</th><th>Quota</th><th>Error</th></tr></thead><tbody>{u.runs.map((r) => (
            <tr key={r.id}><td>{fmtDateTime(r.created_at)}</td><td>{r.user_name}</td><td>{r.kind}</td>
              <td><Badge tone={r.status === 'completed' ? 'ok' : r.status === 'partial' ? 'warn' : 'bad'}>{r.status}</Badge></td><td>{r.units}</td><td>{r.quota_status}</td><td>{r.error_code ?? '—'}</td></tr>
          ))}</tbody></table> : <Empty>No AI runs yet.</Empty>}
        </div>
      </>
    );
  }

  async function Score() {
    const s = await scorecard(ctx);
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
    return (
      <>
        <div className="notice info"><strong>No targets set.</strong> Numerical release targets require a blinded, lawyer-reviewed pilot baseline (DEV-105, DEV-209). These are raw counts with denominators; “verified” means passage support, not a legal-correctness judgment.</div>
        <div className="grid3">
          <div className="card"><h3>Citations labelled verified</h3><p className="kpi">{s.citations.verified} / {s.citations.total}</p><p className="muted">{s.citations.needs} need checking · {s.citations.unverified} unverified</p></div>
          <div className="card"><h3>Editing burden</h3><p className="kpi">{pct(s.editing.changedBlocks, s.editing.aiBlocks)}</p><p className="muted">{s.editing.changedBlocks} of {s.editing.aiBlocks} AI-generated blocks changed by reviewers</p></div>
          <div className="card"><h3>Drafts approved</h3><p className="kpi">{s.drafts.approved} / {s.drafts.total}</p><p className="muted">{s.recovered} draft(s) recovered after AI stopped (partial/manual)</p></div>
          <div className="card"><h3>AI units used</h3><p className="kpi">{s.totalUnits}</p><p className="muted">Per approved draft: {s.unitsPerApprovedDraft ?? '—'} (cost allocation model not validated)</p></div>
          <div className="card"><h3>Denied access attempts</h3><p className="kpi">{s.denials}</p><p className="muted">Cross-scope denials logged in audit</p></div>
          <div className="card"><h3>Sources needing re-check</h3><p className="kpi">{s.staleSources}</p><p className="muted">Last checked over 180 days ago (placeholder cadence)</p></div>
        </div>
        <div className="card">
          <h2>Blind review — Lawyer DNA recognition (FR-036)</h2>
          <p className="muted">{s.recognition.completed} consented review(s). Lawyers compared their DNA draft with a neutral draft, unlabeled. Counts only; no names.</p>
          {s.recognition.completed ? <div className="table-wrap"><table>
            <thead><tr><th>Question</th><th>Picked DNA version</th><th>Picked neutral</th><th>Can’t tell</th></tr></thead>
            <tbody>
              <tr><td>Reads more like my writing</td><td>{s.recognition.voice.personalized}</td><td>{s.recognition.voice.neutral}</td><td>{s.recognition.voice.unsure}</td></tr>
              <tr><td>Follows my analytical approach</td><td>{s.recognition.approach.personalized}</td><td>{s.recognition.approach.neutral}</td><td>{s.recognition.approach.unsure}</td></tr>
            </tbody></table>
            <p className="muted">Legal error noticed — none: {s.recognition.legal.none} · DNA version: {s.recognition.legal.personalized} · neutral: {s.recognition.legal.neutral} · both: {s.recognition.legal.both}. Edit effort — none: {s.recognition.effort.none} · light: {s.recognition.effort.light} · moderate: {s.recognition.effort.moderate} · heavy: {s.recognition.effort.heavy}.</p>
          </div> : <Empty>No blind reviews yet. Lawyers start them from Lawyer DNA → Blind review.</Empty>}
        </div>
        <p><a className="btn" href="/app/account/scorecard-export" download>Download scorecard (CSV) for pilot evidence</a></p>
        <div className="card table-wrap"><h2>AI runs by outcome</h2>
          <table><thead><tr><th>Status</th><th>Runs</th><th>Units</th></tr></thead><tbody>{s.runs.map((r) => <tr key={r.status}><td>{r.status}</td><td>{r.n}</td><td>{r.units}</td></tr>)}</tbody></table></div>
      </>
    );
  }

  async function Audit() {
    const rows = await listAudit(ctx.tenantId);
    return (
      <div className="card table-wrap">
        <h2>Audit log (append-only)</h2>
        <p className="muted">Events record actors, targets and outcomes — never document text or prompts.</p>
        <table><thead><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th><th>Details</th></tr></thead><tbody>{rows.map((r) => (
          <tr key={r.id}><td>{r.id}</td><td>{fmtDateTime(r.created_at)}</td><td>{r.actor_name ?? '—'}</td><td><code>{r.action}</code></td>
            <td><small>{r.target_type ?? ''} {r.target_id ? r.target_id.slice(0, 8) : ''}</small></td>
            <td>{r.outcome === 'ok' ? 'ok' : <Badge tone="bad">{r.outcome}</Badge>}</td><td><small className="mono">{JSON.stringify(r.meta).slice(0, 120)}</small></td></tr>
        ))}</tbody></table>
      </div>
    );
  }
}
