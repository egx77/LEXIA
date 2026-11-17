import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { researchAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Empty, Flash, fmtDateTime, PageHead } from '@/components/ui';
import { aiStatus } from '@/lib/ai/gateway';
import { requirePerm } from '@/lib/authz';
import { listMatters } from '@/lib/matters';
import { listRecentResearch } from '@/lib/research';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'Legal Research' };

export default async function Research({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  await requirePerm(ctx, 'research');
  const types = (sp.types ?? '').split(',').filter(Boolean);
  const [matters, recent, st] = await Promise.all([listMatters(ctx, { status: 'active' }), listRecentResearch(ctx), aiStatus(ctx.tenantId)]);
  return (
    <>
      <PageHead title="Legal Research" sub="Ask a Philippine-law question. Results come only from rights-cleared sources in your permitted scope." />
      <Flash sp={sp} />
      {!st.available && <div className="notice"><strong>AI analysis paused.</strong> Your search will run in keyword mode so you can review passages manually.</div>}
      <div className="grid2" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
        <form action={researchAction} className="card">
          <input type="hidden" name="idem" value={randomUUID()} />
          <div className="field"><label htmlFor="question">Question</label>
            <textarea id="question" name="question" required rows={4} defaultValue={sp.q ?? ''} placeholder="Whether the supplier incurred delay in delivery after written demand? Whether damages may be recovered?" />
            <span className="hint">Separate issues with question marks. Facts you state are treated as unverified allegations.</span></div>
          <div className="row">
            <div className="field"><label htmlFor="matter">Matter context (optional)</label>
              <select id="matter" name="matter" defaultValue={sp.matter ?? ''}><option value="">— none —</option>{matters.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
              <span className="hint">Adds that matter’s library to the permitted scope.</span></div>
          </div>
          <fieldset>
            <legend>Source scope</legend>
            {[['core', 'LEXIA shared core'], ['firm', 'Firm library'], ['personal', 'My personal library'], ['matter', 'Matter library']].map(([v, l]) => (
              <label key={v} className="check" style={{ display: 'inline-flex', marginRight: '1rem' }}><input type="checkbox" name="scope" value={v} defaultChecked /> <span>{l}</span></label>
            ))}
          </fieldset>
          <details open={types.length > 0}>
            <summary><strong>Filters</strong>{types.length > 0 && <> — {types.join(', ')}</>}</summary>
            <fieldset style={{ marginTop: '.5rem' }}>
              <legend>Authority type</legend>
              {['constitution', 'statute', 'rule', 'decision', 'issuance', 'reference'].map((t) => (
                <label key={t} className="check" style={{ display: 'inline-flex', marginRight: '1rem' }}><input type="checkbox" name="stype" value={t} defaultChecked={types.includes(t)} /> <span>{t}</span></label>
              ))}
            </fieldset>
            <div className="row">
              <div className="field"><label htmlFor="court">Court contains</label><input id="court" name="court" /></div>
              <div className="field"><label htmlFor="from">Effective from</label><input id="from" name="from" type="date" /></div>
              <div className="field"><label htmlFor="to">Effective to</label><input id="to" name="to" type="date" /></div>
            </div>
          </details>
          <div style={{ marginTop: '1rem' }}><Submit pendingText="Searching and checking sources…">Research</Submit></div>
        </form>
        <section className="card">
          <h2>Recent research</h2>
          {recent.length ? <ul className="list">{recent.map((r) => <li key={r.id}><Link href={`/app/research/${r.id}`}>{r.question.slice(0, 110)}</Link><br /><small>{fmtDateTime(r.created_at)}</small></li>)}</ul> : <Empty>None yet.</Empty>}
          <p><Link href="/app/library">Browse sources manually →</Link></p>
        </section>
      </div>
    </>
  );
}
