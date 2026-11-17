import Link from 'next/link';
import { registerSourceAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Empty, Flash, fmtDate, PageHead, RightsBadge, Tabs } from '@/components/ui';
import { can } from '@/lib/authz';
import { listMatters } from '@/lib/matters';
import { requireCtx } from '@/lib/session';
import { listSources, USES } from '@/lib/sources';

export const metadata = { title: 'Legal Library' };

export default async function Library({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const tab = sp.tab ?? 'sources';
  const rows = await listSources(ctx);
  const matters = can(ctx, 'matter_work') ? await listMatters(ctx, { status: 'active' }) : [];
  return (
    <>
      <PageHead title="Legal Library" sub="Source registry (FR-006): authority, permitted uses, coverage and last-checked date for every source you can see." />
      <Flash sp={sp} />
      <Tabs base="/app/library" current={tab} tabs={[['sources', 'Sources'], ['register', 'Register a source']]} />
      {tab === 'sources' && (
        <div className="card table-wrap">
          {rows.length ? <table>
            <thead><tr><th>Source</th><th>Library</th><th>Rights</th><th>Permitted uses</th><th>Passages</th><th>Last checked</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td><Link href={`/app/library/${s.id}`}>{s.title}</Link><br /><small>{s.authority} · {s.source_type}{s.is_test_fixture ? ' · TEST FIXTURE' : ''}</small></td>
                <td>{s.scope}</td><td><RightsBadge state={s.rights_state} /></td>
                <td><small>{s.permitted_uses.join(', ') || 'none'}</small></td><td>{s.passages}</td><td>{fmtDate(s.last_checked_at)}</td>
              </tr>
            ))}</tbody>
          </table> : <Empty>No sources in your scope.</Empty>}
          <p className="muted">Public availability of a text is not permission to collect, index or process it with AI. Search uses only sources with cleared rights for indexing and display.</p>
        </div>
      )}
      {tab === 'register' && (
        <form action={registerSourceAction} className="card" style={{ maxWidth: 900 }}>
          <div className="row">
            <div className="field"><label htmlFor="scope">Library</label>
              <select id="scope" name="scope" defaultValue={can(ctx, 'manage_core_sources') ? 'core' : 'personal'}>
                {can(ctx, 'manage_core_sources') && <option value="core">LEXIA shared core</option>}
                {can(ctx, 'manage_firm_sources') && <option value="firm">Firm library</option>}
                {can(ctx, 'research') && <option value="personal">My personal library</option>}
                {matters.length > 0 && <option value="matter">Matter library</option>}
              </select></div>
            {matters.length > 0 && <div className="field"><label htmlFor="matter">Matter (for matter library)</label>
              <select id="matter" name="matter"><option value="">—</option>{matters.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></div>}
          </div>
          <div className="field"><label htmlFor="title">Title</label><input id="title" name="title" required /></div>
          <div className="row">
            <div className="field"><label htmlFor="authority">Issuing authority</label><input id="authority" name="authority" required /></div>
            <div className="field"><label htmlFor="stype">Type</label><select id="stype" name="stype">{['constitution', 'statute', 'rule', 'decision', 'issuance', 'reference'].map((t) => <option key={t}>{t}</option>)}</select></div>
            <div className="field"><label htmlFor="court">Court (decisions)</label><input id="court" name="court" /></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="url">Official URL</label><input id="url" name="url" type="text" /></div>
            <div className="field"><label htmlFor="access">Access method</label><input id="access" name="access" placeholder="manual download, licensed feed…" /></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="coverage">Coverage</label><input id="coverage" name="coverage" /></div>
            <div className="field"><label htmlFor="owner">Rights owner / contact</label><input id="owner" name="owner" /></div>
          </div>
          <div className="field"><label htmlFor="restrictions">Restrictions</label><input id="restrictions" name="restrictions" /></div>
          <fieldset>
            <legend>Rights (DEV-101)</legend>
            <div className="field"><label htmlFor="rights">Rights state</label>
              <select id="rights" name="rights" defaultValue="unknown"><option value="unknown">Unknown — blocks ingestion</option><option value="cleared">Cleared</option><option value="restricted">Restricted</option></select></div>
            {USES.map((u) => <label key={u} className="check" style={{ display: 'inline-flex', marginRight: '1rem' }}><input type="checkbox" name="use" value={u} /> <span>{u.replace('_', ' ')}</span></label>)}
            <label className="check"><input type="checkbox" name="attest" /><span>I confirm the recorded rights are accurate and I am authorized to upload this reference material.</span></label>
            {can(ctx, 'manage_core_sources') && <label className="check"><input type="checkbox" name="fixture" /><span>Mark as synthetic TEST FIXTURE</span></label>}
          </fieldset>
          <Submit>Register source</Submit>
        </form>
      )}
    </>
  );
}
