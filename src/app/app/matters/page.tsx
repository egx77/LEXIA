import Link from 'next/link';
import { Badge, Empty, Flash, fmtDate, PageHead } from '@/components/ui';
import { can } from '@/lib/authz';
import { listMatters } from '@/lib/matters';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'My Matters' };

export default async function Matters({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const rows = await listMatters(ctx, { search: sp.q, status: sp.status || undefined });
  return (
    <>
      <PageHead title="My Matters" sub="Only matters you are assigned to appear here.">
        {can(ctx, 'create_matter') && <Link href="/app/matters/new" className="btn primary">New matter</Link>}
      </PageHead>
      <Flash sp={sp} />
      <form className="row card flat" role="search">
        <div className="field"><label htmlFor="q">Search title or client</label><input id="q" name="q" type="search" defaultValue={sp.q} /></div>
        <div className="field" style={{ flex: '0 1 200px' }}><label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ''}><option value="">All</option><option value="active">Active</option><option value="closed">Closed</option><option value="archived">Archived</option></select></div>
        <button className="btn" style={{ marginBottom: '.9rem' }}>Filter</button>
      </form>
      <div className="card table-wrap">
        {rows.length ? (
          <table>
            <thead><tr><th>Matter</th><th>Client</th><th>Practice area</th><th>Status</th><th>Open tasks</th><th>Updated</th></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id}>
                <td><Link href={`/app/matters/${m.id}`}><strong>{m.title}</strong></Link></td>
                <td>{m.client_name}</td><td>{m.practice_area}</td>
                <td><Badge tone={m.status === 'active' ? 'info' : 'neutral'}>{m.status}</Badge></td>
                <td>{m.open_tasks}</td><td>{fmtDate(m.updated_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>No matters match.</Empty>}
      </div>
    </>
  );
}
