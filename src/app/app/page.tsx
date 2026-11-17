import Link from 'next/link';
import { Badge, Empty, Flash } from '@/components/ui';
import { can } from '@/lib/authz';
import { CATEGORIES, visibleTasks } from '@/lib/catalog';
import { requireCtx } from '@/lib/session';
import { formatManila } from '@/lib/tasks';
import { attention, continueItems } from '@/lib/workdesk';

export const metadata = { title: 'Work Desk' };

export default async function WorkDesk({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const [items, attn] = await Promise.all([continueItems(ctx), attention(ctx)]);
  const open = items.filter((i) => !i.done && i.kind !== 'matter').slice(0, 4);
  const allow = (p: Parameters<typeof can>[1]) => can(ctx, p);
  const cats = CATEGORIES.filter((c) => visibleTasks(allow, c.id).some((t) => t.availability !== 'later'));
  const first = ctx.name.replace(/^atty\.?\s*/i, '').split(' ')[0];
  const attnCount = attn.deadlines.length + attn.unverified.length + attn.toApprove.length + attn.unfinished.length;

  return (
    <>
      <Flash sp={sp} />
      <div className="desk-hero">
        <p>Good day, {first}.</p>
        <h1>What would you like to do today?</h1>
        <p>Your legal work, in your own way.</p>
      </div>

      <form action="/app/start" className="ask" role="search">
        <label htmlFor="ask" className="sr-only">Tell LEXIA what you want to do</label>
        <input id="ask" name="q" placeholder="Or simply tell LEXIA what you want to do… e.g. “Prepare a demand letter for unpaid rent”" autoComplete="off" />
        <button className="btn primary">Go</button>
      </form>

      <div className="paths">
        <Link href="/app/continue" className="path">
          <h2>Continue Work</h2>
          <p>Resume a case, document, research or unfinished task. Pick up where you left off.</p>
          {open.length ? <ul>{open.map((i) => <li key={i.id}>{i.title} <small>· {i.state}</small></li>)}</ul> : <p className="muted">Nothing in progress yet.</p>}
          <span className="go">See all ongoing work →</span>
        </Link>
        <Link href="/app/start" className="path">
          <h2>Start New Work</h2>
          <p>Create a document, research a legal issue or begin a new task. What do you need to accomplish?</p>
          <ul>
            {visibleTasks(allow).filter((t) => t.availability !== 'later').slice(0, 4).map((t) => <li key={t.id}>{t.label}</li>)}
          </ul>
          <span className="go">Browse all tasks →</span>
        </Link>
      </div>

      {cats.length > 0 && (
        <nav className="chips" aria-label="Kinds of work" style={{ justifyContent: 'center', marginBottom: '1.5rem' }}>
          {cats.map((c) => <Link key={c.id} className="chip" href={`/app/start?cat=${c.id}`}>{c.label}</Link>)}
        </nav>
      )}

      {can(ctx, 'matter_work') ? (
        <section className="card attn" aria-labelledby="attn">
          <h2 id="attn">Your attention is needed {attnCount > 0 && <Badge tone="warn">{attnCount}</Badge>}</h2>
          <div className="attn-grid">
            <div>
              <h3>Hearings and deadlines (next 7 days)</h3>
              {attn.deadlines.length ? <ul className="list">{attn.deadlines.map((d) => (
                <li key={d.id}>{d.overdue ? <Badge tone="bad">Overdue</Badge> : <Badge tone="ok">Confirmed</Badge>} <strong>{formatManila(d.due_at)}</strong><br />
                  {d.title} <small>· <Link href={`/app/matters/${d.matter_id}?tab=tasks`}>{d.matter_title}</Link></small></li>
              ))}</ul> : <Empty>No confirmed deadlines this week.</Empty>}
              {attn.unverified.length > 0 && <p><Link href="/app/tasks">{attn.unverified.length} suggested date(s) need your verification →</Link></p>}
            </div>
            <div>
              <h3>Documents awaiting your review</h3>
              {attn.toApprove.length ? <ul className="list">{attn.toApprove.map((d) => (
                <li key={d.id}><Link href={`/app/drafts/${d.id}`}>{d.title}</Link><br /><small>{d.matter_title ?? 'Standalone'} · version {d.current_version}</small></li>
              ))}</ul> : <Empty>{can(ctx, 'approve_legal') ? 'Nothing awaiting your approval.' : 'Lawyers approve documents; you can submit drafts for review.'}</Empty>}
            </div>
            <div>
              <h3>Unfinished work and follow-ups</h3>
              {attn.unfinished.length ? <ul className="list">{attn.unfinished.map((d) => (
                <li key={d.id}><Link href={`/app/drafts/${d.id}`}>{d.title}</Link><br /><small>{d.generation_state === 'manual' ? 'Manual template — analysis to complete' : 'AI stopped part-way — finish the pending sections'}</small></li>
              ))}</ul> : <Empty>No unfinished drafts.</Empty>}
              <p><Link href="/app/tasks">Pending tasks and daily plan →</Link></p>
            </div>
          </div>
        </section>
      ) : (
        <section className="card">
          <h2>Your access</h2>
          <p>Your role does not include privileged matter content.{can(ctx, 'view_billing') && <> See <Link href="/app/account">Account & Usage</Link> for plan, quotas and usage.</>}
            {can(ctx, 'manage_core_sources') && <> Manage the shared corpus in the <Link href="/app/library">Legal Library</Link>.</>}</p>
        </section>
      )}
    </>
  );
}
