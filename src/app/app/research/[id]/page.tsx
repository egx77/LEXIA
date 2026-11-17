import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { generateDraftAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Back, Badge, ClaimBadge, Empty, Flash, fmtDate, PageHead } from '@/components/ui';
import { can } from '@/lib/authz';
import { getResearch } from '@/lib/research';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'Research result' };

export default async function ResearchResultPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  let r;
  try { r = await getResearch(ctx, id); } catch { return <><h1>Research unavailable</h1><p>Not found or not in your scope.</p></>; }
  const res = r.result;
  const counts = { verified: res.claims.filter((c) => c.status === 'verified').length, needs: res.claims.filter((c) => c.status === 'needs_checking').length, un: res.claims.filter((c) => c.status === 'unverified').length };
  const passageIds = new Set(res.claims.flatMap((c) => c.citations.map((x) => x.passage_id)));
  const cited = res.hits.filter((h) => passageIds.has(h.passage_id));
  const other = res.hits.filter((h) => !passageIds.has(h.passage_id));

  return (
    <>
      <PageHead title="Research result" sub={res.question}>
        <Link className="btn" href="/app/research">New question</Link>
      </PageHead>
      <Flash sp={sp} />
      {res.ai !== 'ok' && <div className="notice" role="status"><strong>{res.ai === 'partial' ? 'Partial result.' : 'AI analysis unavailable.'}</strong> {res.ai_message} Search mode: {res.mode}.</div>}
      <div className="panes">
        <aside className="pane left card" aria-label="Issue outline">
          <h2>Issues</h2>
          <ol style={{ paddingLeft: '1.1rem' }}>{res.issues.map((i) => <li key={i}>{i}</li>)}</ol>
          {res.supplied_facts.length > 0 && <><h3>Facts you supplied</h3><p className="muted">Treated as unverified allegations.</p><ul>{res.supplied_facts.map((f) => <li key={f}>{f}</li>)}</ul></>}
          <h3>Status</h3>
          <p><Badge tone="ok">{counts.verified} verified</Badge> <Badge tone="warn">{counts.needs} needs checking</Badge> <Badge tone="bad">{counts.un} unverified</Badge></p>
        </aside>

        <section className="pane center">
          <div className="card doc">
            <h2 style={{ fontFamily: 'var(--font)' }}>Issue analysis</h2>
            {res.claims.length === 0 && <Empty>No AI analysis was produced. Review the passages on the right manually.</Empty>}
            {res.issues.map((issue) => (
              <div key={issue}>
                <div className="blk heading">{issue}</div>
                {res.claims.filter((c) => c.issue === issue).map((c) => (
                  <div className="blk" key={c.id}>
                    {c.text}
                    <div className="meta">
                      <ClaimBadge status={c.status} />
                      {c.citations.map((x) => <a key={x.passage_id} href={`#p-${x.passage_id}`}>{x.source_title}, {x.locator}</a>)}
                    </div>
                    {c.reasons.length > 0 && <ul className="warnings">{c.reasons.map((w) => <li key={w}>{w}</li>)}</ul>}
                  </div>
                ))}
              </div>
            ))}
            <h3 style={{ fontFamily: 'var(--font)', marginTop: '1rem' }}>Limitations</h3>
            <ul className="muted" style={{ fontFamily: 'var(--font)', fontSize: '.9rem' }}>{res.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
          {can(ctx, 'draft') && (
            <form action={generateDraftAction} className="card">
              <h2>Prepare a memorandum from this research</h2>
              <input type="hidden" name="research" value={id} /><input type="hidden" name="docType" value="memorandum" />
              <input type="hidden" name="idem" value={randomUUID()} /><Back value={`/app/research/${id}`} />
              {r.matter_id && <input type="hidden" name="matter" value={r.matter_id} />}
              <div className="field"><label htmlFor="mode">Drafting mode</label>
                <select id="mode" name="mode" defaultValue="neutral">
                  <option value="neutral">Neutral</option>
                  {can(ctx, 'dna') && <><option value="writing">Writing DNA only</option><option value="reasoning">Reasoning DNA only</option><option value="combined">Combined</option></>}
                </select></div>
              <p className="muted">The memo is an editable draft requiring your sign-off. It will not be sent anywhere.</p>
              <Submit>Create memo draft</Submit>
            </form>
          )}
        </section>

        <aside className="pane right" aria-label="Source passages">
          <details className="drawer" open>
            <summary>Evidence — cited passages ({cited.length})</summary>
            {cited.map((h) => <Passage key={h.passage_id} h={h} quotes={res.claims.flatMap((c) => c.citations.filter((x) => x.passage_id === h.passage_id).map((x) => x.quote))} />)}
          </details>
          <details className="drawer" open={cited.length === 0}>
            <summary>Other results ({other.length})</summary>
            {other.length ? other.map((h) => <Passage key={h.passage_id} h={h} quotes={[]} />) : <Empty>None.</Empty>}
          </details>
        </aside>
      </div>
    </>
  );
}

function Passage({ h, quotes }: { h: { passage_id: string; locator: string; text: string; source_id: string; source_title: string; version_label: string; checked_at: Date; warnings: string[]; scope: string }; quotes: string[] }) {
  let body: React.ReactNode = h.text;
  const q = quotes[0];
  if (q && h.text.includes(q)) {
    const i = h.text.indexOf(q);
    body = <>{h.text.slice(0, i)}<mark>{q}</mark>{h.text.slice(i + q.length)}</>;
  }
  return (
    <div className="passage" id={`p-${h.passage_id}`}>
      <strong><Link href={`/app/library/${h.source_id}`}>{h.source_title}</Link></strong>, {h.locator}
      <div><small>Version {h.version_label} · last checked {fmtDate(h.checked_at)} · {h.scope} library</small></div>
      <blockquote>{body}</blockquote>
      {h.warnings.length > 0 && <ul className="warnings">{h.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </div>
  );
}
