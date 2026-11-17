import Link from 'next/link';
import { Badge, Empty, Flash, fmtDateTime, PageHead } from '@/components/ui';
import { requireCtx } from '@/lib/session';
import { continueItems, groupBy, type WorkItem } from '@/lib/workdesk';

export const metadata = { title: 'Continue Work' };

const VIEWS: [string, string][] = [['recent', 'Recent'], ['all', 'All work'], ['client', 'By client'], ['matter', 'By matter']];
const KIND: Record<WorkItem['kind'], string> = { draft: 'Document', research: 'Research', matter: 'Matter' };

export default async function ContinueWork({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view : 'recent';
  const items = await continueItems(ctx);
  const ongoing = items.filter((i) => !i.done);

  return (
    <>
      <PageHead title="Continue Work" sub="Pick up where you left off. Opening an item restores its documents, research, sources, versions and open questions.">
        <Link className="btn primary" href="/app/start">Start new work</Link>
      </PageHead>
      <Flash sp={sp} />
      <nav className="chips" aria-label="Views" style={{ marginBottom: '1rem' }}>
        {VIEWS.map(([k, l]) => <Link key={k} className="chip" href={`/app/continue?view=${k}`} aria-current={view === k ? 'page' : undefined}>{l}</Link>)}
      </nav>
      {view === 'recent' && (
        <section className="card">
          {ongoing.length ? <List items={ongoing.filter((i) => i.kind !== 'matter').slice(0, 12)} /> : <Empty>Nothing in progress. <Link href="/app/start">Start new work</Link>.</Empty>}
        </section>
      )}
      {view === 'all' && <section className="card">{items.length ? <List items={items} /> : <Empty>No work yet.</Empty>}</section>}
      {(view === 'client' || view === 'matter') && (
        groupBy(items, view === 'client' ? 'clientName' : 'matterTitle').map(([g, list]) => (
          <section className="card" key={g}>
            <h2>{g}</h2>
            <List items={list} />
          </section>
        ))
      )}
      {(view === 'client' || view === 'matter') && items.length === 0 && <Empty>No work yet.</Empty>}
    </>
  );
}

function List({ items }: { items: WorkItem[] }) {
  return (
    <ul className="list">
      {items.map((i) => (
        <li key={`${i.kind}-${i.id}`} className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Link href={i.href}><strong>{i.title}</strong></Link>
            <br /><small>{[i.matterTitle && i.kind !== 'matter' ? i.matterTitle : null, i.clientName, i.state].filter(Boolean).join(' · ')}</small>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Badge tone={i.tone}>{KIND[i.kind]}</Badge><br /><small>{fmtDateTime(i.at)}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}
