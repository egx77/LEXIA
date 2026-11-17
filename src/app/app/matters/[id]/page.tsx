import Link from 'next/link';
import { addFactAction, createTaskAction, grantMatterAction, suggestTasksAction, updateMatterAction, uploadDocAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Back, Badge, DraftStatus, Empty, FactBadge, Flash, fmtDate, fmtDateTime, PageHead, Tabs } from '@/components/ui';
import { listMembers } from '@/lib/accounts';
import { can, ROLE_LABEL } from '@/lib/authz';
import { listDrafts } from '@/lib/drafts';
import { FACT_LABEL, getMatter, listDocuments, listFacts, listMatterTeam, matterHistory } from '@/lib/matters';
import { requireCtx } from '@/lib/session';
import { formatManila, listTasks } from '@/lib/tasks';

export const metadata = { title: 'Matter' };

export default async function MatterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  let m;
  try { m = await getMatter(ctx, id); } catch {
    return <><h1>Matter unavailable</h1><div className="flash error" role="alert">You do not have access to this matter.</div><Link href="/app/matters">Back to My Matters</Link></>;
  }
  const tab = sp.tab ?? 'overview';
  const base = `/app/matters/${id}`;
  const here = `${base}?tab=${tab}`;

  return (
    <>
      <PageHead title={m.title} sub={<>{m.client_name} · {m.practice_area} · <Badge tone={m.status === 'active' ? 'info' : 'neutral'}>{m.status}</Badge></>}>
        <Link className="btn" href={`/app/research?matter=${id}`}>Research</Link>
        <Link className="btn primary" href={`/app/drafts/new?matter=${id}`}>Draft document</Link>
        {can(ctx, 'export_matter') && <a className="btn" href={`${base}/export`}>Export records</a>}
      </PageHead>
      <Flash sp={sp} />
      <Tabs base={base} current={tab} tabs={[['overview', 'Overview'], ['facts', 'Facts & chronology'], ['documents', 'Files'], ['tasks', 'Tasks'], ['drafts', 'Drafts'], ['team', 'Team'], ['history', 'History']]} />
      {tab === 'overview' && <Overview m={m} here={here} canClose={can(ctx, 'approve_legal')} />}
      {tab === 'facts' && <Facts id={id} here={here} />}
      {tab === 'documents' && <Docs id={id} here={here} />}
      {tab === 'tasks' && <Tasks id={id} here={here} isLawyer={can(ctx, 'confirm_deadline')} />}
      {tab === 'drafts' && <Drafts id={id} />}
      {tab === 'team' && <Team id={id} here={here} canGrant={can(ctx, 'grant_matter')} />}
      {tab === 'history' && <History id={id} />}
    </>
  );

  async function Overview({ m, here, canClose }: { m: Awaited<ReturnType<typeof getMatter>>; here: string; canClose: boolean }) {
    return (
      <form action={updateMatterAction} className="card" style={{ maxWidth: 900 }}>
        <input type="hidden" name="id" value={m.id} /><input type="hidden" name="version" value={m.version} /><Back value={here} />
        <div className="field"><label htmlFor="title">Matter title</label><input id="title" name="title" defaultValue={m.title} /></div>
        <div className="row">
          <div className="field"><label htmlFor="practice">Practice area</label><input id="practice" name="practice" defaultValue={m.practice_area} /></div>
          <div className="field"><label htmlFor="opposing">Opposing party</label><input id="opposing" name="opposing" defaultValue={m.opposing_party ?? ''} /></div>
          {canClose && <div className="field"><label htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={m.status}><option value="active">Active</option><option value="closed">Closed</option><option value="archived">Archived</option></select></div>}
        </div>
        <div className="field"><label htmlFor="issues">Legal issues (one per line)</label><textarea id="issues" name="issues" rows={5} defaultValue={m.issues} /></div>
        <p className="muted">Version {m.version} · updated {fmtDateTime(m.updated_at)}. Saving checks that nobody else changed the matter since you opened it.</p>
        <Submit>Save matter</Submit>
      </form>
    );
  }

  async function Facts({ id, here }: { id: string; here: string }) {
    const [facts, docs] = await Promise.all([listFacts(ctx, id), listDocuments(ctx, id)]);
    return (
      <div className="grid2">
        <section className="card">
          <h2>Chronology</h2>
          <p className="muted">Allegations are never converted into findings automatically. Evidence and findings must cite a file in this matter.</p>
          {facts.length ? <ul className="list">{facts.map((f) => (
            <li key={f.id}><FactBadge c={f.classification} /> <strong>{f.occurred_on ?? 'Undated'}</strong> — {f.statement}
              {f.source_title && <><br /><small>Source: {f.source_title}{f.source_locator ? `, ${f.source_locator}` : ''}</small></>}</li>
          ))}</ul> : <Empty>No facts recorded.</Empty>}
        </section>
        <form action={addFactAction} className="card">
          <h2>Record a fact</h2>
          <input type="hidden" name="id" value={id} /><Back value={here} />
          <div className="field"><label htmlFor="statement">Statement</label><textarea id="statement" name="statement" required rows={3} /></div>
          <div className="row">
            <div className="field"><label htmlFor="classification">Classification</label>
              <select id="classification" name="classification">{Object.entries(FACT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label htmlFor="occurred">Date (optional)</label><input id="occurred" name="occurred" type="date" /></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="source">Supporting file</label>
              <select id="source" name="source"><option value="">— none —</option>{docs.map((d) => <option key={d.latest_version_id} value={d.latest_version_id}>{d.title} v{d.latest_version}</option>)}</select></div>
            <div className="field"><label htmlFor="locator">Page / paragraph</label><input id="locator" name="locator" /></div>
          </div>
          <Submit>Add fact</Submit>
        </form>
      </div>
    );
  }

  async function Docs({ id, here }: { id: string; here: string }) {
    const docs = await listDocuments(ctx, id);
    return (
      <div className="grid2">
        <section className="card table-wrap">
          <h2>Files</h2>
          {docs.length ? <table><thead><tr><th>File</th><th>Version</th><th>Text</th><th>SHA-256</th></tr></thead><tbody>{docs.map((d) => (
            <tr key={d.id}><td><a href={`/app/files/${d.latest_version_id}`}>{d.title}</a><br /><small>{d.filename} · {(d.size_bytes / 1024).toFixed(1)} KB · {fmtDate(d.updated_at)}</small></td>
              <td>v{d.latest_version}</td><td><Badge tone={d.extraction_status === 'ok' ? 'ok' : 'neutral'}>{d.extraction_status}</Badge></td><td><code>{d.sha256.slice(0, 12)}…</code></td></tr>
          ))}</tbody></table> : <Empty>No files uploaded.</Empty>}
          <p className="muted">Originals are retained; uploading to an existing file adds a new immutable version.</p>
        </section>
        <form action={uploadDocAction} className="card" encType="multipart/form-data">
          <h2>Upload</h2>
          <input type="hidden" name="id" value={id} /><Back value={here} />
          <div className="field"><label htmlFor="file">File (.txt, .docx, .pdf — up to 10 MB)</label><input id="file" name="file" type="file" accept=".txt,.docx,.pdf" required /></div>
          <div className="field"><label htmlFor="title">Title (optional)</label><input id="title" name="title" /></div>
          <div className="field"><label htmlFor="documentId">Add as new version of</label>
            <select id="documentId" name="documentId"><option value="">— new document —</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></div>
          <label className="check"><input type="checkbox" name="attest" required /><span>I am authorized to upload this file for this matter.</span></label>
          <p className="muted">Malware scanning and OCR providers are pending (DEV-203). PDFs are stored as originals without text extraction.</p>
          <Submit>Upload</Submit>
        </form>
      </div>
    );
  }

  async function Tasks({ id, here, isLawyer }: { id: string; here: string; isLawyer: boolean }) {
    const [tasks, members] = await Promise.all([listTasks(ctx, { matterId: id, includeDone: true }), listMatterTeam(ctx, id)]);
    return (
      <div className="grid2">
        <section className="card">
          <h2>Tasks & deadlines</h2>
          {tasks.length ? <ul className="list">{tasks.map((t) => (
            <li key={t.id}>
              {t.verification_status === 'confirmed' ? <Badge tone="ok">{t.kind === 'deadline' ? 'Confirmed deadline' : 'Task'}</Badge>
                : t.verification_status === 'rejected' ? <Badge>Rejected</Badge> : <Badge tone="warn">Suggested — verify before relying on this date</Badge>}
              {' '}{t.status === 'done' && <Badge>Done</Badge>} <strong>{t.title}</strong>
              <br /><small>Due: {formatManila(t.due_at)} · Owner: {t.owner_name ?? '—'}{t.evidence_note ? ` · ${t.evidence_note}` : ''}</small>
            </li>
          ))}</ul> : <Empty>No tasks.</Empty>}
          <form action={suggestTasksAction} style={{ marginTop: '1rem' }}>
            <input type="hidden" name="id" value={id} /><Back value={here} />
            <Submit className="btn">Suggest tasks from facts</Submit>
            <p className="muted">Suggestions name the triggering event only — LEXIA does not compute legal periods. Confirm dates in <Link href="/app/tasks">Tasks & Calendar</Link>.</p>
          </form>
        </section>
        <form action={createTaskAction} className="card">
          <h2>Add manually</h2>
          <input type="hidden" name="id" value={id} /><Back value={here} />
          <div className="field"><label htmlFor="title">Title</label><input id="title" name="title" required /></div>
          <div className="row">
            <div className="field"><label htmlFor="kind">Type</label><select id="kind" name="kind"><option value="task">Task</option><option value="deadline">Deadline</option></select></div>
            <div className="field"><label htmlFor="due">Due (Philippine time)</label><input id="due" name="due" type="datetime-local" /></div>
          </div>
          <div className="field"><label htmlFor="owner">Owner</label><select id="owner" name="owner">{members.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
          {isLawyer && <>
            <label className="check"><input type="checkbox" name="verified" /><span>I have verified this deadline (lawyer confirmation).</span></label>
            <div className="field"><label htmlFor="evidence">Basis of verification</label><input id="evidence" name="evidence" placeholder="e.g. Order dated …, received …" /></div>
          </>}
          {!isLawyer && <p className="muted">Deadlines you add remain unverified until a lawyer confirms them.</p>}
          <Submit>Add</Submit>
        </form>
      </div>
    );
  }

  async function Drafts({ id }: { id: string }) {
    const drafts = await listDrafts(ctx, id);
    return (
      <div className="card">
        <h2>Drafts</h2>
        {drafts.length ? <ul className="list">{drafts.map((d) => (
          <li key={d.id}><Link href={`/app/drafts/${d.id}`}>{d.title}</Link> <DraftStatus status={d.status} /> <small>v{d.current_version} · {d.dna_mode} · {fmtDate(d.created_at)}</small></li>
        ))}</ul> : <Empty>No drafts yet. <Link href={`/app/drafts/new?matter=${id}`}>Draft a document</Link></Empty>}
      </div>
    );
  }

  async function Team({ id, here, canGrant }: { id: string; here: string; canGrant: boolean }) {
    const [team, members] = await Promise.all([listMatterTeam(ctx, id), canGrant ? listMembers(ctx) : Promise.resolve([])]);
    const eligible = members.filter((u) => u.status === 'active' && !team.some((t) => t.user_id === u.user_id) && u.roles.some((r) => r === 'lawyer' || r === 'legal_assistant'));
    return (
      <div className="grid2">
        <section className="card">
          <h2>People with access</h2>
          <ul className="list">{team.map((u) => (
            <li key={u.user_id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{u.name} <small>({u.roles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]).join(', ')})</small></span>
              {canGrant && u.user_id !== ctx.userId && (
                <form action={grantMatterAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="user" value={u.user_id} /><input type="hidden" name="op" value="revoke" /><Back value={here} />
                  <button className="btn small danger">Remove access</button></form>
              )}
            </li>
          ))}</ul>
          <p className="muted">Firm admins do not automatically see privileged matters; access is granted per matter.</p>
        </section>
        {canGrant && (
          <form action={grantMatterAction} className="card">
            <h2>Grant access</h2>
            <input type="hidden" name="id" value={id} /><Back value={here} />
            {eligible.length ? <>
              <div className="field"><label htmlFor="user">Firm member</label><select id="user" name="user">{eligible.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
              <Submit>Grant access</Submit>
            </> : <Empty>All eligible members already have access.</Empty>}
          </form>
        )}
      </div>
    );
  }

  async function History({ id }: { id: string }) {
    const h = await matterHistory(ctx, id);
    return (
      <div className="card table-wrap">
        <h2>Matter history</h2>
        <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Outcome</th></tr></thead><tbody>{h.map((e, i) => (
          <tr key={i}><td>{fmtDateTime(e.created_at)}</td><td>{e.actor_name ?? '—'}</td><td><code>{e.action}</code></td><td>{e.outcome === 'ok' ? 'ok' : <Badge tone="bad">{e.outcome}</Badge>}</td></tr>
        ))}</tbody></table>
      </div>
    );
  }
}
