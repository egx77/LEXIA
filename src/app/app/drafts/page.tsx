import Link from 'next/link';
import { Badge, DraftStatus, Empty, Flash, fmtDate, PageHead } from '@/components/ui';
import { requirePerm } from '@/lib/authz';
import { DOC_TYPES, listDrafts } from '@/lib/drafts';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'Documents' };

export default async function Drafts({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  await requirePerm(ctx, 'draft');
  const rows = await listDrafts(ctx);
  return (
    <>
      <PageHead title="Documents" sub="Memos, pleadings and letters prepared in LEXIA. Uploaded case files live inside each matter.">
        <Link href="/app/drafts/new" className="btn primary">New draft</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="card table-wrap">
        {rows.length ? <table>
          <thead><tr><th>Document</th><th>Type</th><th>Matter</th><th>Mode</th><th>Status</th><th>Version</th><th>Created</th></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.id}>
              <td><Link href={`/app/drafts/${d.id}`}>{d.title}</Link>{d.generation_state !== 'complete' && <> <Badge tone="warn">{d.generation_state}</Badge></>}</td>
              <td>{DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES] ?? d.doc_type}</td>
              <td>{d.matter_title ?? '—'}</td><td>{d.dna_mode}</td><td><DraftStatus status={d.status} /></td><td>v{d.current_version}</td><td>{fmtDate(d.created_at)}</td>
            </tr>
          ))}</tbody>
        </table> : <Empty>No drafts yet.</Empty>}
      </div>
    </>
  );
}
