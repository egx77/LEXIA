import Link from 'next/link';
import { ingestSourceAction, updateRightsAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Badge, Empty, Flash, fmtDate, fmtDateTime, PageHead, RightsBadge } from '@/components/ui';
import { requireCtx } from '@/lib/session';
import { getSourceDetail, statusWarnings, USES } from '@/lib/sources';

export const metadata = { title: 'Source detail' };

export default async function SourceDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  let d;
  try { d = await getSourceDetail(ctx, id); } catch { return <><h1>Source unavailable</h1><p>Not found or not in your permitted scope.</p><Link href="/app/library">Back to library</Link></>; }
  const { source: s, versions, log, passages, displayable, canManage } = d;
  const latest = versions[0];
  return (
    <>
      <PageHead title={s.title} sub={<>{s.authority} · {s.source_type}{s.court ? ` · ${s.court}` : ''} · {s.scope} library {s.is_test_fixture && <Badge tone="warn">TEST FIXTURE</Badge>}</>} />
      <Flash sp={sp} />
      <div className="grid2">
        <section className="card">
          <h2>Registry record</h2>
          <table><tbody>
            <tr><th>Rights</th><td><RightsBadge state={s.rights_state} /></td></tr>
            <tr><th>Permitted uses</th><td>{s.permitted_uses.join(', ') || 'none'}</td></tr>
            <tr><th>Restrictions</th><td>{s.restrictions ?? '—'}</td></tr>
            <tr><th>Official URL</th><td>{s.url ?? '—'}</td></tr>
            <tr><th>Access method</th><td>{s.access_method}</td></tr>
            <tr><th>Coverage</th><td>{s.coverage ?? '—'}</td></tr>
            <tr><th>Owner</th><td>{s.owner ?? '—'}</td></tr>
            <tr><th>Last checked</th><td>{fmtDate(s.last_checked_at)}</td></tr>
          </tbody></table>
        </section>
        <section className="card">
          <h2>Versions</h2>
          {versions.length ? <ul className="list">{versions.map((v) => (
            <li key={v.id}><strong>{v.version_label}</strong> {v.superseded_by ? <Badge>Superseded</Badge> : <Badge tone="info">Current</Badge>}
              <br /><small>Effective {v.effective_date ?? 'unknown'} · checked {fmtDate(v.checked_at)} · {v.passages} passages · hash <code>{v.sha256.slice(0, 12)}…</code> · {v.extraction_version}</small>
              {v.reviewed_status_note && <><br /><small>Reviewed status: {v.reviewed_status_note}</small></>}</li>
          ))}</ul> : <Empty>Nothing ingested.</Empty>}
          {latest && <ul className="warnings">{statusWarnings({ checked_at: latest.checked_at, effective_date: latest.effective_date, reviewed_status_note: latest.reviewed_status_note, superseded: !!latest.superseded_by, is_test_fixture: s.is_test_fixture }).map((w) => <li key={w}>{w}</li>)}</ul>}
        </section>
      </div>

      <section className="card">
        <h2>Passages (current version)</h2>
        {!displayable ? <div className="notice">Display of this source is not permitted by its recorded rights.</div>
          : passages.length ? passages.map((p) => <div key={p.id} className="passage" id={`p-${p.id}`}><strong>{p.locator}</strong><blockquote>{p.text}</blockquote></div>) : <Empty>No passages.</Empty>}
      </section>

      {canManage && (
        <div className="grid2">
          <form action={ingestSourceAction} className="card" encType="multipart/form-data">
            <h2>Ingest a version (FR-007)</h2>
            <input type="hidden" name="id" value={s.id} />
            <p className="muted">Ingestion requires cleared rights with both “ingest” and “index” permitted. Identical text is detected by hash.</p>
            <div className="row">
              <div className="field"><label htmlFor="label">Version label</label><input id="label" name="label" required /></div>
              <div className="field"><label htmlFor="effective">Effective date (if known)</label><input id="effective" name="effective" type="date" /></div>
            </div>
            <div className="field"><label htmlFor="text">Text (blank-line separated; “Art./Sec./Rule N.” becomes the locator)</label><textarea id="text" name="text" rows={6} /></div>
            <div className="field"><label htmlFor="file">…or upload .txt / .docx</label><input id="file" name="file" type="file" accept=".txt,.docx" /></div>
            <div className="field"><label htmlFor="note">Reviewed status note (only if amendment/treatment was actually reviewed)</label><input id="note" name="note" /></div>
            <Submit>Ingest</Submit>
          </form>
          <form action={updateRightsAction} className="card">
            <h2>Update rights</h2>
            <input type="hidden" name="id" value={s.id} />
            <div className="field"><label htmlFor="rights">Rights state</label>
              <select id="rights" name="rights" defaultValue={s.rights_state}>{['unknown', 'cleared', 'restricted', 'suspended'].map((r) => <option key={r}>{r}</option>)}</select></div>
            {USES.map((u) => <label key={u} className="check" style={{ display: 'inline-flex', marginRight: '1rem' }}><input type="checkbox" name="use" value={u} defaultChecked={s.permitted_uses.includes(u)} /> <span>{u.replace('_', ' ')}</span></label>)}
            <div className="field"><label htmlFor="restrictions">Restrictions</label><input id="restrictions" name="restrictions" defaultValue={s.restrictions ?? ''} /></div>
            <p className="muted">Suspending or restricting stops retrieval immediately; existing drafts will show the citation as no longer available.</p>
            <Submit className="btn">Save rights</Submit>
          </form>
        </div>
      )}

      <section className="card">
        <h2>Ingestion log</h2>
        {log.length ? <ul className="list">{log.map((l, i) => <li key={i}><Badge tone={l.outcome === 'ingested' ? 'ok' : l.outcome === 'duplicate' ? 'info' : 'bad'}>{l.outcome}</Badge> {l.message} <small className="muted">{fmtDateTime(l.created_at)}</small></li>)}</ul> : <Empty>No ingestion attempts.</Empty>}
      </section>
    </>
  );
}
