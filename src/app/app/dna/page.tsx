import Link from 'next/link';
import { addSampleAction, consentAction, feedbackDecisionAction, profileAction, withdrawSampleAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Back, Badge, Empty, Flash, fmtDate, fmtDateTime, PageHead, Tabs } from '@/components/ui';
import { requirePerm } from '@/lib/authz';
import { consentHistory, consentState, DNA_NOTICE_VERSION, listFeedback, listProfiles, listSamples, previewParagraph, TRAIT_SPEC, type DnaType, type ProfileRow } from '@/lib/dna';
import { listMatters } from '@/lib/matters';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'Lawyer DNA' };

export default async function DnaPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  await requirePerm(ctx, 'dna');
  const tab = sp.tab ?? 'writing';
  const consent = await consentState(ctx);

  return (
    <>
      <PageHead title="Lawyer DNA" sub="Optional, consented profiles of your observable writing and reasoning preferences. Visible only to you." />
      <Flash sp={sp} />
      <div className="row" style={{ marginBottom: '.75rem' }}>
        <Badge tone={consent.writing ? 'ok' : 'neutral'}>Writing DNA consent: {consent.writing ? 'active' : 'not given'}</Badge>
        <Badge tone={consent.reasoning ? 'ok' : 'neutral'}>Reasoning DNA consent: {consent.reasoning ? 'active' : 'not given'}</Badge>
      </div>
      <Tabs base="/app/dna" current={tab} tabs={[['writing', 'Writing DNA'], ['reasoning', 'Reasoning DNA'], ['consent', 'Consent'], ['samples', 'Samples'], ['feedback', 'Feedback']]} />
      {(tab === 'writing' || tab === 'reasoning') && <Profile type={tab} hasConsent={consent[tab]} />}
      {tab === 'consent' && <Consent />}
      {tab === 'samples' && <Samples />}
      {tab === 'feedback' && <Feedback />}
    </>
  );

  async function Profile({ type, hasConsent }: { type: DnaType; hasConsent: boolean }) {
    const versions = await listProfiles(ctx, type);
    const active = versions.find((v) => v.status === 'active' || v.status === 'disabled');
    const draft = versions.find((v) => v.status === 'draft');
    const label = type === 'writing' ? 'Writing DNA' : 'Reasoning DNA';
    if (!hasConsent) {
      return <div className="card"><h2>{label} is off</h2><p>Nothing about your {type === 'writing' ? 'writing' : 'analysis'} is analyzed unless you consent. Normal drafting works without it.</p>
        <Link className="btn primary" href="/app/dna?tab=consent">Review consent notice</Link></div>;
    }
    const neutral = previewParagraph(undefined);
    const personal = previewParagraph(type === 'writing' ? active?.traits : undefined);
    return (
      <div className="grid2">
        <section className="card">
          <h2>{active ? `Approved profile v${active.version}` : 'No approved profile'} {active && <Badge tone={active.status === 'active' ? 'ok' : 'neutral'}>{active.status}</Badge>}</h2>
          {active ? <>
            <TraitList p={active} />
            <form action={profileAction} className="row" style={{ marginTop: '.75rem' }}>
              <input type="hidden" name="type" value={type} /><input type="hidden" name="op" value={active.status === 'active' ? 'disable' : 'enable'} />
              <Submit className="btn">{active.status === 'active' ? 'Disable profile' : 'Enable profile'}</Submit>
            </form>
          </> : <Empty>Add samples, then analyze to propose traits for your review.</Empty>}
          <form action={profileAction} style={{ marginTop: '.75rem' }}>
            <input type="hidden" name="type" value={type} /><input type="hidden" name="op" value="analyze" />
            <Submit className="btn">Analyze my samples → propose a new draft profile</Submit>
          </form>
          <p className="muted">Small sample sets yield low-confidence traits (DEV-208 pending). Traits describe observable patterns only — not your private thinking.</p>
        </section>

        {draft ? (
          <form action={profileAction} className="card">
            <h2>Review draft profile v{draft.version}</h2>
            <input type="hidden" name="type" value={type} /><input type="hidden" name="version" value={draft.version} />
            {draft.traits.map((t) => {
              const spec = TRAIT_SPEC[type][t.key];
              return (
                <fieldset key={t.key}>
                  <legend>{t.label} <Badge tone={t.confidence === 'high' ? 'ok' : t.confidence === 'medium' ? 'info' : 'warn'}>{t.confidence} confidence</Badge></legend>
                  <div className="field"><label htmlFor={`v-${t.key}`}>Preference</label>
                    <select id={`v-${t.key}`} name={`v:${t.key}`} defaultValue={String(t.value)}>{spec.values.map((v) => <option key={String(v)} value={String(v)}>{spec.describe(v)}</option>)}</select></div>
                  <div className="field"><label htmlFor={`s-${t.key}`}>Statement (editable)</label><input id={`s-${t.key}`} name={`s:${t.key}`} defaultValue={t.statement} /></div>
                  <label className="check"><input type="checkbox" name={`e:${t.key}`} defaultChecked={t.enabled} /><span>Use this trait</span></label>
                  <small className="muted">Evidence: {t.evidence.map((e) => e.sample_title).join('; ') || '—'}</small>
                </fieldset>
              );
            })}
            <div className="row">
              <button className="btn" name="op" value="edit">Save edits</button>
              <button className="btn primary" name="op" value="approve">Approve & activate v{draft.version}</button>
            </div>
            <p className="muted">Approve saves the profile as currently stored — save edits first.</p>
          </form>
        ) : (
          <section className="card">
            <h2>Preview: neutral vs personalized</h2>
            <p className="muted">Generic fictional text — never drawn from your samples.</p>
            <div className="grid2">
              <div className="doc"><strong>Neutral</strong><p className="blk heading">{neutral.heading}</p><p>{neutral.body}</p></div>
              <div className="doc"><strong>{type === 'writing' ? 'Your Writing DNA' : 'Reasoning DNA'}</strong>
                {type === 'writing' ? <><p className="blk heading">{personal.heading}</p><p>{personal.body}</p></>
                  : <p>Reasoning DNA changes issue order, sections (counterarguments, risks) and authority ordering in full drafts. Use “Compare with Neutral” on any draft.</p>}</div>
            </div>
          </section>
        )}

        <section className="card">
          <h2>Version history</h2>
          <ul className="list">{versions.map((v) => <li key={v.id}>v{v.version} <Badge tone={v.status === 'active' ? 'ok' : v.status === 'draft' ? 'info' : 'neutral'}>{v.status}</Badge> <small>{v.source_note} · {fmtDateTime(v.created_at)}</small></li>)}</ul>
        </section>
      </div>
    );
  }

  async function Consent() {
    const hist = await consentHistory(ctx);
    return (
      <div className="grid2">
        <section className="card">
          <h2>Notice</h2>
          <div className="notice"><strong>Draft notice pending legal review</strong> ({DNA_NOTICE_VERSION}).</div>
          <ul>
            <li>Consent is separate for Writing DNA and Reasoning DNA, and separate from your account.</li>
            <li>Only samples you upload and attest you may use are analyzed. Profiles are visible only to you and never shared across lawyers, firms or matters.</li>
            <li>LEXIA does not train shared models on your samples. Profile changes happen only when you approve them.</li>
            <li>Personalization never overrides law, evidence, procedure or your approval.</li>
            <li>Withdrawing stops use immediately. Deletion follows the approved retention policy (pending); backups expire on their own schedule.</li>
          </ul>
        </section>
        <section className="card">
          {(['writing', 'reasoning'] as const).map((p) => (
            <form key={p} action={consentAction} className="card flat">
              <input type="hidden" name="purpose" value={p} /><Back value="/app/dna?tab=consent" />
              <h3>{p === 'writing' ? 'Writing DNA' : 'Reasoning DNA'}</h3>
              {consent[p] ? <>
                <p><Badge tone="ok">Consent active</Badge></p>
                <input type="hidden" name="op" value="withdraw" /><Submit className="btn danger">Withdraw consent</Submit>
              </> : <>
                <label className="check"><input type="checkbox" name="read" required /><span>I have read the notice and consent to {p} analysis of samples I authorize.</span></label>
                <input type="hidden" name="op" value="grant" /><Submit>Give consent</Submit>
              </>}
            </form>
          ))}
          <h3>History</h3>
          {hist.length ? <ul className="list">{hist.map((h, i) => <li key={i}>{h.purpose}: granted {fmtDateTime(h.granted_at)}{h.withdrawn_at ? ` · withdrawn ${fmtDateTime(h.withdrawn_at)}` : ''}</li>)}</ul> : <Empty>No consent records.</Empty>}
        </section>
      </div>
    );
  }

  async function Samples() {
    const [samples, matters] = await Promise.all([listSamples(ctx), listMatters(ctx, { status: 'active' })]);
    return (
      <div className="grid2">
        <section className="card">
          <h2>Your samples</h2>
          {samples.length ? <ul className="list">{samples.map((s) => (
            <li key={s.id}><strong>{s.title}</strong> <Badge tone={s.status === 'active' ? 'ok' : 'neutral'}>{s.status}</Badge>
              <br /><small>{s.doc_type ?? 'document'} · {s.practice_area ?? '—'} · {s.confidentiality.replace('_', ' ')} · used for: {s.purposes.join(', ') || 'none'}{s.matter_id ? ' · matter-restricted' : ''} · {s.chars} chars · {fmtDate(s.created_at)}</small>
              <br /><small>Provenance: {s.provenance}</small>
              {s.status === 'active' && <form action={withdrawSampleAction}><input type="hidden" name="sample" value={s.id} /><button className="linkish">Withdraw</button></form>}
            </li>
          ))}</ul> : <Empty>No samples.</Empty>}
        </section>
        <form action={addSampleAction} className="card" encType="multipart/form-data">
          <h2>Add an authorized sample</h2>
          <div className="field"><label htmlFor="title">Title</label><input id="title" name="title" /></div>
          <div className="field"><label htmlFor="file">Upload .txt or .docx</label><input id="file" name="file" type="file" accept=".txt,.docx" /></div>
          <div className="field"><label htmlFor="text">…or paste text</label><textarea id="text" name="text" rows={5} /></div>
          <div className="row">
            <div className="field"><label htmlFor="docType">Document type</label><input id="docType" name="docType" placeholder="Pleading, opinion, contract…" /></div>
            <div className="field"><label htmlFor="practice">Practice area</label><input id="practice" name="practice" /></div>
          </div>
          <div className="field"><label htmlFor="provenance">Provenance</label><input id="provenance" name="provenance" required placeholder="Where this came from and why you may use it" /></div>
          <div className="row">
            <div className="field"><label htmlFor="confidentiality">Confidentiality</label>
              <select id="confidentiality" name="confidentiality"><option value="non_confidential">Non-confidential</option><option value="public_record">Public record</option><option value="confidential_permitted">Confidential — use explicitly permitted</option></select></div>
            <div className="field"><label htmlFor="matter">Restrict to matter</label>
              <select id="matter" name="matter"><option value="">— not matter-specific —</option>{matters.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></div>
          </div>
          <fieldset><legend>Use for</legend>
            <label className="check"><input type="checkbox" name="purpose" value="writing" defaultChecked={consent.writing} disabled={!consent.writing} /><span>Writing DNA {!consent.writing && '(consent needed)'}</span></label>
            <label className="check"><input type="checkbox" name="purpose" value="reasoning" defaultChecked={consent.reasoning} disabled={!consent.reasoning} /><span>Reasoning DNA {!consent.reasoning && '(consent needed)'}</span></label>
          </fieldset>
          <label className="check"><input type="checkbox" name="attest" required /><span>I have authority to use this document as a sample for my own profile.</span></label>
          <Submit>Add sample</Submit>
        </form>
      </div>
    );
  }

  async function Feedback() {
    const rows = await listFeedback(ctx);
    return (
      <div className="card">
        <h2>Proposed profile refinements</h2>
        <p className="muted">Proposals come from comparing AI drafts with your saved edits. Nothing is learned silently: rejecting leaves your profile unchanged; accepting creates a new version you can undo.</p>
        {rows.length ? <ul className="list">{rows.map((f) => (
          <li key={f.id}>
            <Badge tone={f.status === 'proposed' ? 'info' : f.status === 'accepted' ? 'ok' : 'neutral'}>{f.status}</Badge> <strong>{f.type === 'writing' ? 'Writing' : 'Reasoning'} DNA</strong> from <Link href={`/app/drafts/${f.draft_id}`}>{f.draft_title}</Link> (base v{f.base_profile_version}{f.resulting_profile_version ? ` → v${f.resulting_profile_version}` : ''})
            <ul>{f.proposal.changes.map((c) => <li key={c.key}><strong>{c.label}:</strong> {String(c.from)} → {String(c.to)}<br /><small className="muted">{c.reason}</small></li>)}</ul>
            <form action={feedbackDecisionAction} className="row">
              <input type="hidden" name="id" value={f.id} />
              {f.status === 'proposed' && <><button className="btn small primary" name="decision" value="accept">Accept</button><button className="btn small" name="decision" value="reject">Reject</button></>}
              {f.status === 'accepted' && <button className="btn small" name="decision" value="undo">Undo</button>}
            </form>
          </li>
        ))}</ul> : <Empty>No proposals. Edit a personalized draft, save, then choose “Propose Lawyer DNA refinements”.</Empty>}
      </div>
    );
  }
}

function TraitList({ p }: { p: ProfileRow }) {
  return (
    <ul className="list">{p.traits.map((t) => (
      <li key={t.key}><strong>{t.label}</strong> {!t.enabled && <Badge>off</Badge>} <Badge tone={t.confidence === 'high' ? 'ok' : t.confidence === 'medium' ? 'info' : 'warn'}>{t.confidence}</Badge><br />{t.statement}
        <br /><small className="muted">Evidence: {t.evidence.map((e) => e.sample_title).join('; ') || '—'}</small></li>
    ))}</ul>
  );
}
