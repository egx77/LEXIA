import Link from 'next/link';
import { Badge, Flash, PageHead } from '@/components/ui';
import { can } from '@/lib/authz';
import { AVAILABILITY_LABEL, CATEGORIES, matchTasks, visibleTasks, wantsContinue, type CategoryId, type TaskDef } from '@/lib/catalog';
import { requireCtx } from '@/lib/session';
import { continueItems, matchWork } from '@/lib/workdesk';

export const metadata = { title: 'Start New Work' };

/** Carry the lawyer's own words into the task screen so they are not asked twice. */
function withQ(href: string, q?: string) {
  if (!q) return href;
  return `${href}${href.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}`;
}

export default async function StartWork({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const allow = (p: Parameters<typeof can>[1]) => can(ctx, p);
  const q = sp.q?.trim().slice(0, 500);
  const cat = (CATEGORIES.some((c) => c.id === sp.cat) ? sp.cat : 'write') as CategoryId;

  if (q) {
    const tasks = matchTasks(q, visibleTasks(allow));
    const work = matchWork(q, await continueItems(ctx));
    const continueFirst = wantsContinue(q) && work.length > 0;
    const workBlock = work.length > 0 && (
      <section className="card">
        <h2>Continue existing work?</h2>
        <ul className="list">{work.map(({ item }) => (
          <li key={`${item.kind}-${item.id}`}><Link href={item.href}><strong>{item.title}</strong></Link><br /><small>{[item.matterTitle, item.state].filter(Boolean).join(' · ')}</small></li>
        ))}</ul>
      </section>
    );
    return (
      <>
        <PageHead title="Here’s what I found" sub={<>You said: “{q}”. Choose how to proceed — nothing starts until you confirm.</>} />
        <Flash sp={sp} />
        <form action="/app/start" className="ask" role="search" style={{ margin: '0 0 1.25rem' }}>
          <label htmlFor="ask" className="sr-only">Tell LEXIA what you want to do</label>
          <input id="ask" name="q" defaultValue={q} />
          <button className="btn primary">Search again</button>
        </form>
        {continueFirst && workBlock}
        <section className="card">
          <h2>{continueFirst ? 'Or start new work' : 'Start new work'}</h2>
          {tasks.length ? <div className="tasks">{tasks.map(({ task }) => <TaskCard key={task.id} t={task} q={q} />)}</div>
            : <p>I couldn’t match that to a task. You can <Link href={withQ('/app/research', q)}>research it as a legal question</Link>, <Link href="/app/chat">ask LEXIA</Link>, or browse the catalog below.</p>}
        </section>
        {!continueFirst && workBlock}
        <p className="muted">LEXIA matches your words to tasks and your existing work; it never files, sends or schedules anything on its own. <Link href="/app/start">Browse all tasks →</Link></p>
      </>
    );
  }

  const list = visibleTasks(allow, cat);
  const ready = list.filter((t) => t.availability !== 'later');
  const laterList = list.filter((t) => t.availability === 'later');
  const c = CATEGORIES.find((x) => x.id === cat)!;
  return (
    <>
      <PageHead title="Start New Work" sub="Choose what you want to accomplish. LEXIA guides you through it and brings in research, your matter files and Lawyer DNA as needed." />
      <Flash sp={sp} />
      <form action="/app/start" className="ask" role="search" style={{ margin: '0 0 1.25rem' }}>
        <label htmlFor="ask" className="sr-only">Tell LEXIA what you want to do</label>
        <input id="ask" name="q" placeholder="Describe the task… e.g. “Draft an answer for the Santos case”" />
        <button className="btn primary">Go</button>
      </form>
      <div className="cat-layout">
        <nav className="cat-nav" aria-label="Kinds of work">
          {CATEGORIES.map((x) => <Link key={x.id} href={`/app/start?cat=${x.id}`} aria-current={x.id === cat ? 'page' : undefined}>{x.label}</Link>)}
        </nav>
        <div>
          <h2>{c.label}</h2>
          <p className="muted">{c.blurb}</p>
          {ready.length > 0 && <div className="tasks" style={{ marginBottom: '1.25rem' }}>{ready.map((t) => <TaskCard key={t.id} t={t} />)}</div>}
          {laterList.length > 0 && <>
            <h3>Coming later</h3>
            <p className="muted">Shown so you can see where LEXIA is going. These are not available yet; nothing is simulated.</p>
            <div className="tasks">{laterList.map((t) => <TaskCard key={t.id} t={t} />)}</div>
          </>}
        </div>
      </div>
    </>
  );
}

function TaskCard({ t, q }: { t: TaskDef; q?: string }) {
  const body = (
    <>
      <strong>{t.label}</strong>
      <small>{t.detail}</small>
      {t.availability !== 'ready' && <span className="note">{t.note ?? 'Not available yet.'}</span>}
      <span><Badge tone={t.availability === 'ready' ? 'ok' : t.availability === 'partial' ? 'info' : 'neutral'}>{AVAILABILITY_LABEL[t.availability]}</Badge></span>
    </>
  );
  if (t.availability === 'later' || !t.href) return <div className={`task ${t.availability}`} aria-disabled="true">{body}</div>;
  return <Link className="task" href={withQ(t.href, q)}>{body}</Link>;
}
