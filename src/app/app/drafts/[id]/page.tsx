import Link from 'next/link';
import { proposeFeedbackAction, reviewDraftAction, saveDraftAction } from '@/app/actions';
import { Submit, UnsavedGuard } from '@/components/client';
import { Badge, ClaimBadge, DraftStatus, Empty, FactBadge, Flash, fmtDate, fmtDateTime, PageHead } from '@/components/ui';
import { can } from '@/lib/authz';
import { one } from '@/lib/db';
import { diffContents, DOC_TYPES, getDraft, needsChecking, type Block, type DraftContent } from '@/lib/drafts';
import { requireCtx } from '@/lib/session';
import { resolvePassages } from '@/lib/sources';

export const metadata = { title: 'Draft' };

export default async function DraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  let data;
  try { data = await getDraft(ctx, id, sp.v ? Number(sp.v) : undefined); } catch {
    return <><h1>Draft unavailable</h1><div className="flash error" role="alert">This draft was not found or you do not have access to its matter.</div></>;
  }
  const { draft, version, versions, approval } = data;
  const content = version.content;
  const isCurrent = version.version === draft.current_version;
  const open = needsChecking(content);
  const ids = [...new Set(content.blocks.flatMap((b) => b.claim?.citations.map((c) => c.passage_id) ?? []))];
  const passages = await resolvePassages(ctx, ids, 'display');
  const approvedHere = approval && approval.target_version === version.version && draft.status === 'approved';
  const view = sp.view ?? 'edit';
  const base = `/app/drafts/${id}`;
  const p = content.personalization;

  let diff: ReturnType<typeof diffContents> | null = null;
  if (view === 'diff') {
    const first = await one<{ content: DraftContent }>(`select content from draft_versions where draft_id = $1 and version = 1`, [id]);
    if (first) diff = diffContents(first.content, content);
  }

  return (
    <>
      <PageHead title={draft.title} sub={<>{DOC_TYPES[draft.doc_type]}{draft.matter_title && <> · <Link href={`/app/matters/${draft.matter_id}`}>{draft.matter_title}</Link></>} · <DraftStatus status={draft.status} /> · version {version.version}{!isCurrent && ' (older version, read-only)'}</>}>
        <a className="btn" href={`${base}/export?v=${version.version}`}>Export Word</a>
      </PageHead>
      <Flash sp={sp} />
      {draft.generation_state !== 'complete' && (
        <div className="notice" role="status"><strong>{draft.generation_state === 'manual' ? 'Manual template.' : 'Partial draft — AI stopped before finishing.'}</strong> Your matter facts and any completed analysis were saved. Sections marked “Analysis pending” need manual research; editing and Word export work normally.</div>
      )}
      {approvedHere && <div className="flash ok">✓ Lawyer approved by {approval!.actor_name} on {fmtDateTime(approval!.created_at)} · approval hash <code>{approval!.action_hash.slice(0, 16)}…</code>{approval!.acknowledged_open_items > 0 && ` · ${approval!.acknowledged_open_items} open item(s) acknowledged`}. Any edit will require re-approval. LEXIA has not filed or sent this document.</div>}

      <nav className="tabs" aria-label="Views">
        <Link href={base} aria-current={view === 'edit' ? 'page' : undefined}>{isCurrent ? 'Edit & review' : 'View'}</Link>
        {draft.neutral_content && <Link href={`${base}?view=compare`} aria-current={view === 'compare' ? 'page' : undefined}>Compare with Neutral</Link>}
        <Link href={`${base}?view=diff`} aria-current={view === 'diff' ? 'page' : undefined}>What changed since AI draft</Link>
      </nav>

      {view === 'compare' && draft.neutral_content ? (
        <div className="grid2">
          <section className="card doc"><h2 style={{ fontFamily: 'var(--font)' }}>Personalized ({p.effective})</h2>{content.blocks.map((b) => <ReadBlock key={b.id} b={b} />)}</section>
          <section className="card doc"><h2 style={{ fontFamily: 'var(--font)' }}>Neutral</h2>{draft.neutral_content.blocks.map((b) => <ReadBlock key={b.id} b={b} />)}</section>
        </div>
      ) : view === 'diff' ? (
        <section className="card">
          <h2>Changes from version 1 to version {version.version}</h2>
          {diff?.length ? <ul className="list">{diff.map((d, i) => (
            <li key={i}><Badge tone={d.type === 'added' ? 'ok' : d.type === 'removed' ? 'bad' : 'info'}>{d.type}</Badge>
              {d.before && <div className="diff-del" style={{ whiteSpace: 'pre-wrap' }}>{d.before}</div>}
              {d.after && <div className="diff-add" style={{ whiteSpace: 'pre-wrap' }}>{d.after}</div>}</li>
          ))}</ul> : <Empty>No changes.</Empty>}
        </section>
      ) : (
        <div className="panes">
          <aside className="pane left">
            <div className="card">
              <h2>Outline</h2>
              <nav className="outline" aria-label="Document outline">
                {content.blocks.filter((b) => b.kind === 'heading' || b.kind === 'title').map((b) => <a key={b.id} href={`#b-${b.id}`}>{b.text.slice(0, 70)}</a>)}
              </nav>
            </div>
            <div className="card">
              <h2>Needs checking ({open.length})</h2>
              {open.length ? <ul className="list">{open.map((o, i) => <li key={i}><a href={`#b-${o.blockId}`}>{o.label}</a><br /><small>{o.reasons[0]}</small></li>)}</ul> : <Empty>No open items.</Empty>}
            </div>
            <div className="card">
              <h2>Personalization</h2>
              <p>Requested: <strong>{p.requested}</strong><br />Applied: <strong>{p.effective}</strong>
                {p.writing_version && <><br />Writing DNA v{p.writing_version}</>}{p.reasoning_version && <><br />Reasoning DNA v{p.reasoning_version}</>}</p>
              {p.notes.length > 0 && <ul className="muted" style={{ fontSize: '.85rem', paddingLeft: '1rem' }}>{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </div>
            <div className="card">
              <h2>Versions</h2>
              <ul className="list">{versions.map((v) => (
                <li key={v.version}><Link href={v.version === draft.current_version ? base : `${base}?v=${v.version}`}>v{v.version}</Link> · {v.author_kind} · {v.author_name}<br /><small>{v.note} · {fmtDateTime(v.created_at)}</small></li>
              ))}</ul>
            </div>
          </aside>

          <section className="pane center">
            {isCurrent ? (
              <form id="editor" action={saveDraftAction} className="card doc">
                <UnsavedGuard formId="editor" />
                <input type="hidden" name="id" value={id} /><input type="hidden" name="base" value={draft.current_version} />
                {content.blocks.map((b) => (
                  <div key={b.id} id={`b-${b.id}`} className={`blk ${b.kind}`}>
                    <label htmlFor={`t-${b.id}`} className="sr-only">{b.kind} text</label>
                    <textarea id={`t-${b.id}`} name={`b:${b.id}`} defaultValue={b.text} rows={Math.min(14, Math.max(b.kind === 'heading' || b.kind === 'title' ? 1 : 2, Math.ceil(b.text.length / 90) + b.text.split('\n').length - 1))} />
                    <BlockMeta b={b} />
                    <label className="check" style={{ fontFamily: 'var(--font)', fontSize: '.82rem', marginTop: '.3rem' }}><input type="checkbox" name="del" value={b.id} /><span>Remove this block</span></label>
                  </div>
                ))}
                <fieldset style={{ fontFamily: 'var(--font)' }}>
                  <legend>Add a block at the end</legend>
                  <div className="row">
                    <div className="field" style={{ flex: '0 1 160px' }}><label htmlFor="appendKind">Type</label><select id="appendKind" name="appendKind"><option value="para">Paragraph</option><option value="heading">Heading</option></select></div>
                    <div className="field"><label htmlFor="appendText">Text</label><textarea id="appendText" name="appendText" rows={2} /></div>
                  </div>
                </fieldset>
                <div className="row" style={{ fontFamily: 'var(--font)' }}>
                  <div className="field"><label htmlFor="note">Version note</label><input id="note" name="note" placeholder="What did you change?" /></div>
                  <Submit pendingText="Saving and re-checking…">Save new version</Submit>
                </div>
                <p className="muted" style={{ fontFamily: 'var(--font)', fontSize: '.85rem' }}>Saving creates an immutable version, re-checks every citation and clears any prior approval.</p>
              </form>
            ) : (
              <div className="card doc">{content.blocks.map((b) => <ReadBlock key={b.id} b={b} />)}</div>
            )}

            {isCurrent && (
              <div className="card">
                <h2>Review & approval</h2>
                {draft.status === 'draft' && !can(ctx, 'approve_legal') && (
                  <form action={reviewDraftAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="op" value="submit" />
                    <Submit className="btn">Submit for lawyer review</Submit></form>
                )}
                {can(ctx, 'approve_legal') && !approvedHere && (
                  <form action={reviewDraftAction}>
                    <input type="hidden" name="id" value={id} /><input type="hidden" name="op" value="approve" /><input type="hidden" name="version" value={version.version} />
                    <p>You are approving <strong>version {version.version}</strong> exactly as shown. Approval does not file, serve or send anything.</p>
                    {open.length > 0 && <label className="check"><input type="checkbox" name="ack" /><span>I have reviewed the {open.length} open item(s) listed under “Needs checking” and take professional responsibility for them.</span></label>}
                    <Submit>Approve version {version.version}</Submit>
                  </form>
                )}
                {!can(ctx, 'approve_legal') && <p className="muted">Only a lawyer can give final approval.</p>}
                {can(ctx, 'dna') && versions[0]?.author_kind === 'lawyer' && (
                  <form action={proposeFeedbackAction} style={{ marginTop: '1rem' }}>
                    <input type="hidden" name="id" value={id} />
                    <Submit className="btn">Propose Lawyer DNA refinements from my edits</Submit>
                    <p className="muted">Creates proposals only — your profile changes only if you accept each one.</p>
                  </form>
                )}
              </div>
            )}
          </section>

          <aside className="pane right" aria-label="Cited sources">
            <details className="drawer" open>
              <summary>Cited source passages ({passages.size})</summary>
              {ids.length === 0 && <Empty>No citations in this version.</Empty>}
              {ids.map((pid) => {
                const ps = passages.get(pid);
                if (!ps) return <div key={pid} className="passage" id={`p-${pid}`}><Badge tone="bad">Not available</Badge> This citation does not resolve to an authorized passage in your scope.</div>;
                return (
                  <div key={pid} className="passage" id={`p-${pid}`}>
                    <strong><Link href={`/app/library/${ps.source_id}`}>{ps.source_title}</Link></strong>, {ps.locator}
                    <div><small>Version {ps.version_label} · last checked {fmtDate(ps.checked_at)}</small></div>
                    <blockquote>{ps.text}</blockquote>
                    {ps.warnings.length > 0 && <ul className="warnings">{ps.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                  </div>
                );
              })}
            </details>
          </aside>
        </div>
      )}
    </>
  );
}

function BlockMeta({ b }: { b: Block }) {
  if (!b.claim && !b.fact) return null;
  return (
    <div className="meta">
      {b.claim && <><ClaimBadge status={b.claim.status} />{b.claim.citations.map((c) => <a key={c.passage_id} href={`#p-${c.passage_id}`}>{c.source_title}, {c.locator}</a>)}</>}
      {b.fact && <FactBadge c={b.fact.classification} />}
      {b.claim && b.claim.reasons.length > 0 && <ul className="warnings" style={{ width: '100%' }}>{b.claim.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
    </div>
  );
}

function ReadBlock({ b }: { b: Block }) {
  return (
    <div className={`blk ${b.kind}`} id={`b-${b.id}`} style={{ whiteSpace: 'pre-wrap' }}>
      {b.text}
      <BlockMeta b={b} />
    </div>
  );
}
