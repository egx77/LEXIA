import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createTaskAction, startDraftTaskAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Back, Flash, PageHead } from '@/components/ui';
import { aiStatus } from '@/lib/ai/gateway';
import { can, type Ctx } from '@/lib/authz';
import { getTask, guessChoice, type TaskDef } from '@/lib/catalog';
import { applicableProfiles } from '@/lib/dna';
import { listMatters, listMatterTeam } from '@/lib/matters';
import { requireCtx } from '@/lib/session';

const GUIDED = new Set(['write-pleading', 'write-letter', 'write-memo', 'set-deadline']);

export async function generateMetadata({ params }: { params: Promise<{ task: string }> }) {
  const t = getTask((await params).task);
  return { title: t?.label ?? 'Start work' };
}

export default async function GuidedTask({ params, searchParams }: { params: Promise<{ task: string }>; searchParams: Promise<Record<string, string>> }) {
  const { task: id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const task = getTask(id);
  if (!task) notFound();
  if (!GUIDED.has(id)) redirect(task.href && task.href !== `/app/start/${id}` ? task.href : '/app/start');
  if (task.perm && !can(ctx, task.perm)) {
    return <><PageHead title={task.label} /><div className="flash error" role="alert">Your role does not include this task.</div><Link href="/app/start">Back to tasks</Link></>;
  }
  return id === 'set-deadline' ? <Deadline ctx={ctx} sp={sp} /> : <Draft ctx={ctx} task={task} sp={sp} />;
}

async function Draft({ ctx, task, sp }: { ctx: Ctx; task: TaskDef; sp: Record<string, string> }) {
  const [matters, st] = await Promise.all([listMatters(ctx, { status: 'active' }), aiStatus(ctx.tenantId)]);
  const prof = can(ctx, 'dna') ? await applicableProfiles(ctx, 'combined') : null;
  const isMemo = task.id === 'write-memo';
  const said = sp.q ?? '';
  const asked = said ? guessChoice(task, said) : undefined;
  const firstReady = task.choices?.find((c) => c.ready)?.value;
  const docDefault = asked?.ready ? asked.value : firstReady;
  const preMatter = matters.find((m) => m.id === sp.matter) ?? (said ? matters.find((m) => said.toLowerCase().includes(m.client_name.toLowerCase().split(' ').pop()!)) : undefined);
  const mmDefault = preMatter || matters.length ? 'existing' : can(ctx, 'create_matter') ? 'new' : isMemo ? 'standalone' : 'existing';
  const noun = isMemo ? 'memorandum' : task.id === 'write-letter' ? 'letter' : 'pleading';
  const backTo = `/app/start/${task.id}${sp.matter ? `?matter=${sp.matter}` : ''}`;
  let n = 0;

  return (
    <>
      <PageHead title={task.label} sub={<>New work · {task.detail}</>}>
        <Link className="btn" href="/app/start?cat=write">All writing tasks</Link>
      </PageHead>
      <Flash sp={sp} />
      {asked && !asked.ready && <div className="notice"><strong>The {asked.label} template is not available yet.</strong> You can choose one of the available types below; LEXIA will not imitate a template it does not have.</div>}
      {!st.available && <div className="notice"><strong>AI analysis is paused.</strong> LEXIA will still create a structured draft with your matter facts; the analysis sections will be marked for manual completion.</div>}

      <form action={startDraftTaskAction} encType="multipart/form-data" style={{ maxWidth: 920 }}>
        <input type="hidden" name="task" value={task.id} /><input type="hidden" name="idem" value={randomUUID()} /><Back value={backTo} />

        {isMemo ? <input type="hidden" name="docType" value="memorandum" /> : (
          <fieldset className="step">
            <legend><span className="num">{++n}</span>What type of {noun}?</legend>
            <div className="option-grid">
              {task.choices!.map((c) => (
                <label key={c.value} className={`option${c.ready ? '' : ' off'}`} title={c.ready ? undefined : 'Template coming later'}>
                  <input type="radio" name="docType" value={c.value} defaultChecked={c.value === docDefault} disabled={!c.ready} required />
                  <span>{c.label}{!c.ready && <><br /><small>Coming later</small></>}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="step">
          <legend><span className="num">{++n}</span>{isMemo ? 'Is this for a matter?' : 'Which matter is this for?'}</legend>
          <div className="option-grid">
            <label className="option"><input id="mm-existing" type="radio" name="matterMode" value="existing" defaultChecked={mmDefault === 'existing'} disabled={!matters.length} /><span>Use an existing case or matter</span></label>
            {can(ctx, 'create_matter') && <label className="option"><input id="mm-new" type="radio" name="matterMode" value="new" defaultChecked={mmDefault === 'new'} /><span>Start a new matter</span></label>}
            {isMemo
              ? <label className="option"><input type="radio" name="matterMode" value="standalone" defaultChecked={mmDefault === 'standalone'} /><span>Standalone document</span></label>
              : <label className="option off" title="Pleadings and letters stay inside a matter so access and facts are controlled"><input type="radio" disabled /><span>Standalone<br /><small>Not for {noun}s</small></span></label>}
          </div>
          <div className="reveal r-existing">
            <div className="field"><label htmlFor="matter">Matter</label>
              <select id="matter" name="matter" defaultValue={preMatter?.id ?? matters[0]?.id}>{matters.map((m) => <option key={m.id} value={m.id}>{m.title} — {m.client_name}</option>)}</select></div>
          </div>
          <div className="reveal r-new">
            <div className="row">
              <div className="field"><label htmlFor="client">Client name</label><input id="client" name="client" /></div>
              <div className="field" style={{ flex: '0 1 200px' }}><label htmlFor="clientKind">Client is</label>
                <select id="clientKind" name="clientKind"><option value="individual">an individual</option><option value="organization">an organization</option></select></div>
            </div>
            <div className="row">
              <div className="field"><label htmlFor="mtitle">Matter title</label><input id="mtitle" name="mtitle" placeholder="e.g. Santos v. Reyes" /></div>
              <div className="field"><label htmlFor="opposing">Opposing party</label><input id="opposing" name="opposing" /></div>
            </div>
            <div className="field"><label htmlFor="practice">Practice area</label><input id="practice" name="practice" placeholder="Civil Litigation, Labor, Corporate…" /></div>
          </div>
        </fieldset>

        <fieldset className="step">
          <legend><span className="num">{++n}</span>Describe the facts and what you need</legend>
          <div className="field"><label htmlFor="facts">Facts or instructions (one per line)</label>
            <textarea id="facts" name="facts" rows={5} defaultValue={said} placeholder={'Client delivered goods on 3 March 2026.\nRespondent has not paid despite written demand.'} />
            <label className="check" style={{ marginTop: '.4rem' }}><input type="checkbox" name="saveFacts" defaultChecked /><span>Save each line to the matter as an <strong>unverified allegation</strong> (you can reclassify it once evidence is attached).</span></label></div>
          <div className="field"><label htmlFor="issues">{isMemo ? 'Questions to answer (one per line)' : 'Issues to address (one per line, optional)'}</label>
            <textarea id="issues" name="issues" rows={3} placeholder={isMemo ? 'Whether demand is required before delay arises?' : 'Leave blank to use the issues recorded on the matter'} />
            <span className="hint">Each issue is researched only in sources you are permitted to use.</span></div>
          {!isMemo && <div className="field"><label htmlFor="title">Document title (optional)</label><input id="title" name="title" /></div>}
        </fieldset>

        <fieldset className="step">
          <legend><span className="num">{++n}</span>Supporting documents (optional)</legend>
          <div className="field"><label htmlFor="file">Attach files to the matter (.txt, .docx, .pdf · up to 10 MB each)</label><input id="file" name="file" type="file" multiple accept=".txt,.docx,.pdf" /></div>
          <label className="check"><input type="checkbox" name="attest" /><span>I am authorized to upload these documents to this matter.</span></label>
          <p className="muted" style={{ marginBottom: 0 }}>Voice input — coming later.</p>
        </fieldset>

        {can(ctx, 'dna') && (
          <fieldset className="step">
            <legend><span className="num">{++n}</span>Personalization</legend>
            <label className="check"><input type="checkbox" name="dnaWriting" defaultChecked={!!prof?.writing} disabled={!prof?.writing} />
              <span>Apply my Writing DNA {prof?.writing ? <small>(profile v{prof.writing.version})</small> : <small>— no approved profile yet. <Link href="/app/dna">Set it up</Link></small>}</span></label>
            <label className="check"><input type="checkbox" name="dnaReasoning" defaultChecked={!!prof?.reasoning} disabled={!prof?.reasoning} />
              <span>Apply my Reasoning DNA {prof?.reasoning ? <small>(profile v{prof.reasoning.version})</small> : <small>— no approved profile yet. <Link href="/app/dna">Set it up</Link></small>}</span></label>
            <p className="muted" style={{ marginBottom: 0 }}>A neutral version is kept for comparison. Preferences never change the law, facts or the approval requirement.</p>
          </fieldset>
        )}

        <div className="card flat">
          <p style={{ marginBottom: '.4rem' }}><strong>What LEXIA will do</strong></p>
          <div className="flowline"><span>Gather matter facts</span>→<span>Research each issue in permitted sources</span>→<span>Draft{can(ctx, 'dna') ? ' in your style' : ''}</span>→<span>Verify every citation</span>→<span>Your review &amp; approval</span></div>
          <p className="muted" style={{ marginTop: '.6rem', marginBottom: 0 }}>The result is an editable draft. Nothing is filed, served or sent.</p>
        </div>
        <Submit pendingText={`Preparing your ${noun}…`}>Prepare {noun} draft</Submit>
      </form>
    </>
  );
}

async function Deadline({ ctx, sp }: { ctx: Ctx; sp: Record<string, string> }) {
  const isTask = sp.kind === 'task';
  const matters = await listMatters(ctx, { status: 'active' });
  const matter = matters.find((m) => m.id === sp.matter);
  const title = isTask ? 'Assign a task' : 'Set a deadline';
  if (!matter) {
    return (
      <>
        <PageHead title={title} sub="Step 1 of 2 — which matter is this for?" />
        <Flash sp={sp} />
        {matters.length ? (
          <form action="/app/start/set-deadline" className="card" style={{ maxWidth: 640 }}>
            {isTask && <input type="hidden" name="kind" value="task" />}
            <div className="field"><label htmlFor="matter">Matter</label>
              <select id="matter" name="matter">{matters.map((m) => <option key={m.id} value={m.id}>{m.title} — {m.client_name}</option>)}</select></div>
            <button className="btn primary">Continue</button>
          </form>
        ) : <div className="card"><p>You have no active matters. {can(ctx, 'create_matter') && <Link href="/app/matters/new">Open a matter first</Link>}</p></div>}
      </>
    );
  }
  const team = await listMatterTeam(ctx, matter.id);
  const self = `/app/start/set-deadline?matter=${matter.id}${isTask ? '&kind=task' : ''}`;
  return (
    <>
      <PageHead title={title} sub={<>Step 2 of 2 · {matter.title} · <Link href={`/app/start/set-deadline${isTask ? '?kind=task' : ''}`}>change matter</Link></>} />
      <Flash sp={sp} />
      <form action={createTaskAction} className="card" style={{ maxWidth: 760 }}>
        <input type="hidden" name="id" value={matter.id} /><input type="hidden" name="kind" value={isTask ? 'task' : 'deadline'} /><Back value={self} />
        <div className="field"><label htmlFor="title">{isTask ? 'What needs to be done?' : 'What is due?'}</label><input id="title" name="title" required placeholder={isTask ? 'Prepare exhibits index' : 'File Answer'} /></div>
        <div className="row">
          <div className="field"><label htmlFor="due">{isTask ? 'Due (optional, Philippine time)' : 'Due date and time (Philippine time)'}</label><input id="due" name="due" type="datetime-local" required={!isTask} /></div>
          <div className="field"><label htmlFor="owner">Assigned to</label>
            <select id="owner" name="owner" defaultValue={ctx.userId}>{team.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}{u.user_id === ctx.userId ? ' (me)' : ''}</option>)}</select>
            <span className="hint">Only people already assigned to this matter can be chosen.</span></div>
        </div>
        {!isTask && (can(ctx, 'confirm_deadline') ? (
          <fieldset>
            <legend>Verification</legend>
            <label className="check"><input type="checkbox" name="verified" /><span>I have verified this date myself (it will appear as <strong>Confirmed</strong> and reminders will be scheduled).</span></label>
            <div className="field"><label htmlFor="evidence">Basis you verified</label><input id="evidence" name="evidence" placeholder="Order received / rule applied / notice date checked" /></div>
            <p className="muted">Leave unticked to record it as an unverified suggestion for a lawyer to check. LEXIA does not compute deadlines.</p>
          </fieldset>
        ) : <p className="muted">This will be saved as an unverified date until a lawyer verifies it.</p>)}
        <Submit>{isTask ? 'Assign task' : 'Save deadline'}</Submit>
      </form>
    </>
  );
}
