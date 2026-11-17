'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import * as accounts from '@/lib/accounts';
import { setSimulation, setUsage, type Simulation } from '@/lib/ai/gateway';
import { sendChat } from '@/lib/chat';
import * as dna from '@/lib/dna';
import * as drafts from '@/lib/drafts';
import { DomainError } from '@/lib/errors';
import { extractText, mimeFor } from '@/lib/extract';
import * as matters from '@/lib/matters';
import * as pilot from '@/lib/pilot';
import { acceptPolicies, recordDemoRequest, selectPlan } from '@/lib/policies';
import { runResearch } from '@/lib/research';
import { attempt, clearSessionCookie, requireCtx, safePath, sessionToken, setSessionCookie, withMsg } from '@/lib/session';
import * as sources from '@/lib/sources';
import * as tasks from '@/lib/tasks';

const s = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const back = (fd: FormData, fallback = '/app') => safePath(fd.get('back'), fallback);
const devLinks = () => process.env.LEXIA_ENV !== 'production';

// ---------- Public / auth ----------

export async function signUpAction(fd: FormData) {
  const r = await attempt(() => accounts.registerAccount({ name: s(fd, 'name'), email: s(fd, 'email'), password: s(fd, 'password'), firmName: s(fd, 'firm') }), '/signup');
  // No email provider is approved; in non-production the verification link is shown directly.
  redirect(devLinks() ? `/signup/check?token=${encodeURIComponent(r.verifyToken)}` : '/signup/check');
}

export async function signInAction(fd: FormData) {
  const token = await attempt(() => accounts.signIn(s(fd, 'email'), s(fd, 'password')), '/signin');
  await setSessionCookie(token);
  redirect(safePath(fd.get('next'), '/app'));
}

export async function signOutAction() {
  const t = await sessionToken();
  if (t) await accounts.signOut(t);
  await clearSessionCookie();
  redirect('/signin?ok=' + encodeURIComponent('You have signed out.'));
}

export async function forgotAction(fd: FormData) {
  const token = await accounts.requestPasswordReset(s(fd, 'email'));
  const msg = 'If an account exists for that email, a reset link has been issued.';
  redirect(devLinks() && token ? `/forgot?ok=${encodeURIComponent(msg)}&dev=${encodeURIComponent(token)}` : `/forgot?ok=${encodeURIComponent(msg)}`);
}

export async function resetAction(fd: FormData) {
  const token = s(fd, 'token');
  await attempt(() => accounts.resetPassword(token, s(fd, 'password')), `/reset?token=${encodeURIComponent(token)}`);
  redirect('/signin?ok=' + encodeURIComponent('Password updated. Sign in with your new password.'));
}

export async function acceptInviteAction(fd: FormData) {
  const token = s(fd, 'token');
  await attempt(() => accounts.acceptInvitation(token, { name: s(fd, 'name'), password: s(fd, 'password') }), `/invite/${encodeURIComponent(token)}`);
  redirect('/signin?ok=' + encodeURIComponent('You have joined the firm. Sign in to continue.'));
}

export async function demoRequestAction(fd: FormData) {
  await attempt(() => recordDemoRequest({ name: s(fd, 'name'), email: s(fd, 'email'), firm: s(fd, 'firm'), message: s(fd, 'message') }), '/demo');
  redirect('/demo?ok=' + encodeURIComponent('Thank you. Your demo request was recorded. (No email is sent from this prototype.)'));
}

export async function textSizeAction(fd: FormData) {
  (await cookies()).set('lexia_text', s(fd, 'size') === 'large' ? 'large' : 'normal', { path: '/', maxAge: 31536000, sameSite: 'lax' });
  redirect(back(fd));
}

export async function switchTenantAction(fd: FormData) {
  const ctx = await requireCtx();
  const t = await sessionToken();
  await attempt(() => accounts.switchTenant(t!, ctx.userId, s(fd, 'tenant')), '/app');
  redirect('/app');
}

export async function onboardingAction(fd: FormData) {
  const ctx = await requireCtx();
  await attempt(() => acceptPolicies(ctx, fd.getAll('policy').map(String)), '/onboarding');
  if (ctx.roles.includes('firm_admin') && s(fd, 'plan')) await attempt(() => selectPlan(ctx, s(fd, 'plan')), '/onboarding');
  redirect('/app?ok=' + encodeURIComponent('Welcome to LEXIA Counsel.'));
}

export async function selectPlanAction(fd: FormData) {
  const ctx = await requireCtx();
  await attempt(() => selectPlan(ctx, s(fd, 'plan')), '/app/account');
  redirect(withMsg('/app/account', 'ok', 'Plan placeholder updated. No payment was taken.'));
}

// ---------- Matters ----------

export async function createMatterAction(fd: FormData) {
  const ctx = await requireCtx();
  const r = await attempt(() => matters.createMatter(ctx, { clientName: s(fd, 'client'), clientKind: s(fd, 'clientKind') === 'organization' ? 'organization' : 'individual',
    title: s(fd, 'title'), practiceArea: s(fd, 'practice'), opposingParty: s(fd, 'opposing'), issues: s(fd, 'issues') }), '/app/matters/new');
  redirect(`/app/matters/${r.matter_id}?ok=${encodeURIComponent('Matter created.')}`);
}

export async function updateMatterAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const b = back(fd, `/app/matters/${id}`);
  const status = s(fd, 'status');
  await attempt(() => matters.updateMatter(ctx, id, Number(s(fd, 'version')), {
    title: fd.has('title') ? s(fd, 'title') : undefined, practiceArea: fd.has('practice') ? s(fd, 'practice') : undefined,
    opposingParty: fd.has('opposing') ? s(fd, 'opposing') : undefined, issues: fd.has('issues') ? s(fd, 'issues') : undefined,
    status: status === 'active' || status === 'closed' || status === 'archived' ? status : undefined,
  }), b);
  redirect(withMsg(b, 'ok', 'Matter saved.'));
}

export async function grantMatterAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const b = back(fd, `/app/matters/${id}?tab=team`);
  if (s(fd, 'op') === 'revoke') await attempt(() => matters.revokeMatterGrant(ctx, id, s(fd, 'user')), b);
  else await attempt(() => matters.grantMatter(ctx, id, s(fd, 'user')), b);
  redirect(withMsg(b, 'ok', 'Matter access updated.'));
}

export async function addFactAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const b = back(fd, `/app/matters/${id}?tab=facts`);
  await attempt(() => matters.addFact(ctx, id, { statement: s(fd, 'statement'), classification: s(fd, 'classification') as matters.FactClass,
    occurredOn: s(fd, 'occurred') || undefined, sourceVersionId: s(fd, 'source') || undefined, locator: s(fd, 'locator') }), b);
  redirect(withMsg(b, 'ok', 'Fact recorded with its classification.'));
}

export async function uploadDocAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const b = back(fd, `/app/matters/${id}?tab=documents`);
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) redirect(withMsg(b, 'error', 'Choose a file to upload.'));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await attempt(() => matters.uploadDocument(ctx, id, { filename: file.name, mime: file.type, bytes,
    title: s(fd, 'title'), rightsAttested: fd.get('attest') === 'on', documentId: s(fd, 'documentId') || undefined }), b);
  redirect(withMsg(b, 'ok', `Uploaded version ${r.version}. Text extraction: ${r.extraction}.`));
}

// ---------- Tasks ----------

export async function suggestTasksAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const b = back(fd, `/app/matters/${id}?tab=tasks`);
  const n = await attempt(() => tasks.suggestTasks(ctx, id), b);
  redirect(withMsg(b, 'ok', n ? `${n} suggestion(s) added — each is unverified until a lawyer confirms it.` : 'No new suggestions from the recorded facts.'));
}

export async function createTaskAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const b = back(fd, `/app/matters/${id}?tab=tasks`);
  await attempt(() => tasks.createTask(ctx, id, { title: s(fd, 'title'), kind: s(fd, 'kind') === 'deadline' ? 'deadline' : 'task', dueLocal: s(fd, 'due') || undefined,
    verifiedByMe: fd.get('verified') === 'on', evidenceNote: s(fd, 'evidence'), ownerId: s(fd, 'owner') || undefined }), b);
  redirect(withMsg(b, 'ok', 'Saved.'));
}

export async function confirmDeadlineAction(fd: FormData) {
  const ctx = await requireCtx();
  const b = back(fd, '/app/tasks');
  await attempt(() => tasks.confirmDeadline(ctx, s(fd, 'task'), { dueLocal: s(fd, 'due'), evidenceNote: s(fd, 'evidence') }), b);
  redirect(withMsg(b, 'ok', 'Deadline confirmed by you and reminders scheduled.'));
}

export async function taskStateAction(fd: FormData) {
  const ctx = await requireCtx();
  const b = back(fd, '/app/tasks');
  const op = s(fd, 'op');
  if (op === 'reject') await attempt(() => tasks.rejectSuggestion(ctx, s(fd, 'task')), b);
  else await attempt(() => tasks.setTaskStatus(ctx, s(fd, 'task'), op === 'reopen' ? 'open' : 'done'), b);
  redirect(withMsg(b, 'ok', 'Task updated.'));
}

export async function saveActionPlanAction(fd: FormData) {
  const ctx = await requireCtx();
  await attempt(() => tasks.saveActionPlan(ctx, fd.getAll('task').map(String)), '/app/tasks');
  redirect(withMsg('/app/tasks', 'ok', 'Daily action plan saved.'));
}

// ---------- Research & drafting ----------

export async function researchAction(fd: FormData) {
  const ctx = await requireCtx();
  const matterId = s(fd, 'matter') || undefined;
  const scopes = fd.getAll('scope').map(String) as sources.Scope[];
  const r = await attempt(() => runResearch(ctx, { question: s(fd, 'question'), matterId, scopes: scopes.length ? scopes : undefined,
    sourceTypes: fd.getAll('stype').map(String).filter(Boolean), court: s(fd, 'court'), dateFrom: s(fd, 'from') || undefined, dateTo: s(fd, 'to') || undefined,
    idempotencyKey: s(fd, 'idem') || undefined }), '/app/research');
  redirect(`/app/research/${r.queryId}`);
}

export async function generateDraftAction(fd: FormData) {
  const ctx = await requireCtx();
  const b = back(fd, '/app/drafts/new');
  const out = await attempt(() => drafts.generateDraft(ctx, { matterId: s(fd, 'matter') || undefined, docType: s(fd, 'docType') as drafts.DocType,
    dnaMode: (s(fd, 'mode') || 'neutral') as dna.DnaMode, title: s(fd, 'title'), issuesText: fd.has('issues') ? s(fd, 'issues') : undefined,
    researchQueryId: s(fd, 'research') || undefined, idempotencyKey: s(fd, 'idem') || undefined }), b);
  redirect(withMsg(`/app/drafts/${out.draftId}`, out.state === 'complete' ? 'ok' : 'error',
    out.state === 'complete' ? 'Draft generated. Review every citation and fact before approval.' : out.message ?? 'Draft created without full AI analysis.'));
}

export async function saveDraftAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const b = `/app/drafts/${id}`;
  const texts: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith('b:')) texts[k.slice(2)] = String(v).replace(/\r\n/g, '\n');
  const deleted = fd.getAll('del').map(String);
  const appendText = s(fd, 'appendText');
  const v = await attempt(() => drafts.saveDraftVersion(ctx, id, { baseVersion: Number(s(fd, 'base')), texts, deleted,
    append: appendText.trim() ? { kind: s(fd, 'appendKind') === 'heading' ? 'heading' : 'para', text: appendText } : null, note: s(fd, 'note') }), b);
  redirect(withMsg(b, 'ok', `Saved as version ${v}. Citations were re-checked.`));
}

export async function reviewDraftAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const b = `/app/drafts/${id}`;
  const op = s(fd, 'op');
  if (op === 'submit') {
    await attempt(() => drafts.submitForReview(ctx, id), b);
    redirect(withMsg(b, 'ok', 'Submitted for lawyer review.'));
  }
  const hash = await attempt(() => drafts.approveDraft(ctx, id, { version: Number(s(fd, 'version')), acknowledgeOpenItems: fd.get('ack') === 'on' }), b);
  redirect(withMsg(b, 'ok', `Approved version ${s(fd, 'version')} (approval hash ${hash.slice(0, 12)}…). Nothing was filed or sent.`));
}

export async function proposeFeedbackAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const n = await attempt(() => drafts.proposeDnaFeedback(ctx, id), `/app/drafts/${id}`);
  redirect(withMsg(n ? '/app/dna?tab=feedback' : `/app/drafts/${id}`, 'ok', n ? `${n} proposal(s) created. Nothing changes until you accept.` : 'No profile changes detected from your edits.'));
}

// ---------- Legal library ----------

export async function registerSourceAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = await attempt(() => sources.registerSource(ctx, { scope: s(fd, 'scope') as sources.Scope, matterId: s(fd, 'matter') || undefined, title: s(fd, 'title'),
    authority: s(fd, 'authority'), sourceType: s(fd, 'stype'), court: s(fd, 'court'), url: s(fd, 'url'), accessMethod: s(fd, 'access'), coverage: s(fd, 'coverage'),
    owner: s(fd, 'owner'), restrictions: s(fd, 'restrictions'), rightsState: s(fd, 'rights') as sources.RightsState, permittedUses: fd.getAll('use').map(String),
    rightsAttested: fd.get('attest') === 'on', isTestFixture: fd.get('fixture') === 'on' }), '/app/library?tab=register');
  redirect(`/app/library/${id}?ok=${encodeURIComponent('Source registered. Ingest text once rights permit.')}`);
}

export async function ingestSourceAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const b = `/app/library/${id}`;
  let text = s(fd, 'text');
  const file = fd.get('file');
  if (file instanceof File && file.size > 0) {
    const mime = mimeFor(file.name, file.type);
    if (!mime) redirect(withMsg(b, 'error', 'Unsupported file type for ingestion (.txt or .docx).'));
    const ex = await extractText(mime, new Uint8Array(await file.arrayBuffer()));
    text = ex.text ?? '';
  }
  const r = await attempt(() => sources.ingestSource(ctx, id, { versionLabel: s(fd, 'label'), effectiveDate: s(fd, 'effective') || undefined, text, reviewedStatusNote: s(fd, 'note') }), b);
  redirect(withMsg(b, 'ok', r.duplicate ? 'Identical text already ingested — no new version created.' : `Ingested ${r.passages} passage(s).`));
}

export async function updateRightsAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const b = `/app/library/${id}`;
  await attempt(() => sources.updateSourceRights(ctx, id, s(fd, 'rights') as sources.RightsState, fd.getAll('use').map(String), s(fd, 'restrictions') || undefined), b);
  redirect(withMsg(b, 'ok', 'Rights updated. Retrieval follows the new permissions immediately.'));
}

// ---------- Lawyer DNA ----------

export async function consentAction(fd: FormData) {
  const ctx = await requireCtx();
  const purpose = s(fd, 'purpose') === 'reasoning' ? 'reasoning' : 'writing';
  const b = back(fd, '/app/dna?tab=consent');
  if (s(fd, 'op') === 'withdraw') {
    await attempt(() => dna.withdrawConsent(ctx, purpose), b);
    redirect(withMsg(b, 'ok', 'Consent withdrawn. The profile is no longer applied; deletion follows the approved retention policy.'));
  }
  if (fd.get('read') !== 'on') redirect(withMsg(b, 'error', 'Please confirm you have read the notice.'));
  await attempt(() => dna.grantConsent(ctx, purpose), b);
  redirect(withMsg(b, 'ok', 'Consent recorded.'));
}

export async function addSampleAction(fd: FormData) {
  const ctx = await requireCtx();
  const b = '/app/dna?tab=samples';
  let text = s(fd, 'text');
  const file = fd.get('file');
  if (file instanceof File && file.size > 0) {
    const mime = mimeFor(file.name, file.type);
    if (!mime) redirect(withMsg(b, 'error', 'Unsupported file type (.txt or .docx).'));
    const ex = await extractText(mime, new Uint8Array(await file.arrayBuffer()));
    if (!ex.text) redirect(withMsg(b, 'error', 'Could not extract text from that file.'));
    text = ex.text;
  }
  await attempt(() => dna.addSample(ctx, { title: s(fd, 'title') || (file instanceof File ? file.name : ''), text, purposes: fd.getAll('purpose').map(String) as dna.DnaType[],
    matterId: s(fd, 'matter') || undefined, practiceArea: s(fd, 'practice'), docType: s(fd, 'docType'), provenance: s(fd, 'provenance'),
    confidentiality: (s(fd, 'confidentiality') || 'non_confidential') as dna.SampleInput['confidentiality'], authorityAttested: fd.get('attest') === 'on' }), b);
  redirect(withMsg(b, 'ok', 'Sample added. Run analysis to propose traits.'));
}

export async function withdrawSampleAction(fd: FormData) {
  const ctx = await requireCtx();
  await attempt(() => dna.withdrawSample(ctx, s(fd, 'sample')), '/app/dna?tab=samples');
  redirect(withMsg('/app/dna?tab=samples', 'ok', 'Sample withdrawn; it will no longer be used.'));
}

export async function profileAction(fd: FormData) {
  const ctx = await requireCtx();
  const type = s(fd, 'type') === 'reasoning' ? 'reasoning' : 'writing';
  const b = `/app/dna?tab=${type}`;
  const op = s(fd, 'op');
  if (op === 'analyze') { const v = await attempt(() => dna.analyzeProfile(ctx, type), b); redirect(withMsg(b, 'ok', `Draft profile v${v} proposed. Review and edit each trait before approving.`)); }
  if (op === 'approve') { await attempt(() => dna.approveProfile(ctx, type, Number(s(fd, 'version'))), b); redirect(withMsg(b, 'ok', 'Profile approved and active.')); }
  if (op === 'disable' || op === 'enable') { await attempt(() => dna.setProfileEnabled(ctx, type, op === 'enable'), b); redirect(withMsg(b, 'ok', `Profile ${op}d.`)); }
  if (op === 'edit') {
    const edits: Record<string, { value?: string; enabled?: boolean; statement?: string }> = {};
    for (const key of Object.keys(dna.TRAIT_SPEC[type])) {
      edits[key] = { value: fd.has(`v:${key}`) ? s(fd, `v:${key}`) : undefined, enabled: fd.get(`e:${key}`) === 'on', statement: s(fd, `s:${key}`) || undefined };
    }
    await attempt(() => dna.editDraftTraits(ctx, type, Number(s(fd, 'version')), edits), b);
    redirect(withMsg(b, 'ok', 'Draft profile updated.'));
  }
  redirect(b);
}

export async function feedbackDecisionAction(fd: FormData) {
  const ctx = await requireCtx();
  const d = s(fd, 'decision');
  if (d !== 'accept' && d !== 'reject' && d !== 'undo') throw new DomainError('invalid_input', 'Invalid decision');
  const v = await attempt(() => dna.decideFeedback(ctx, s(fd, 'id'), d), '/app/dna?tab=feedback');
  redirect(withMsg('/app/dna?tab=feedback', 'ok', d === 'reject' ? 'Rejected — your profile did not change.' : `Profile is now version ${v}.`));
}

// ---------- Team & account ----------

export async function inviteAction(fd: FormData) {
  const ctx = await requireCtx();
  const token = await attempt(() => accounts.inviteMember(ctx, s(fd, 'email'), fd.getAll('role').map(String)), '/app/team');
  redirect(withMsg(devLinks() ? `/app/team?invite=${encodeURIComponent(token)}` : '/app/team', 'ok', 'Invitation created.'));
}

export async function memberAction(fd: FormData) {
  const ctx = await requireCtx();
  const user = s(fd, 'user');
  if (s(fd, 'op') === 'revoke') await attempt(() => accounts.revokeMember(ctx, user), '/app/team');
  else await attempt(() => accounts.updateMemberRoles(ctx, user, fd.getAll('role').map(String)), '/app/team');
  redirect(withMsg('/app/team', 'ok', 'Member updated.'));
}

export async function simulationAction(fd: FormData) {
  const ctx = await requireCtx();
  if (fd.has('used')) await attempt(() => setUsage(ctx, Number(s(fd, 'used'))), '/app/account');
  else await attempt(() => setSimulation(ctx, s(fd, 'simulation') as Simulation), '/app/account');
  redirect(withMsg('/app/account', 'ok', 'Test-environment AI condition updated.'));
}

export async function chatAction(fd: FormData) {
  const ctx = await requireCtx();
  const matter = s(fd, 'matter');
  const b = matter ? `/app/chat?matter=${matter}` : '/app/chat';
  await attempt(() => sendChat(ctx, s(fd, 'text'), matter || undefined), b);
  redirect(b + '#latest');
}

// ---------- Work Desk: guided "Start New Work" drafting (task-oriented workspace) ----------

/**
 * One guided step: choose or open the matter, record the lawyer's facts as unverified allegations,
 * attach supporting files, then run the normal drafting workflow. Every step uses the same
 * permission-checked domain functions as the individual screens; nothing is filed or sent.
 */
export async function startDraftTaskAction(fd: FormData) {
  const ctx = await requireCtx();
  const task = s(fd, 'task');
  let b = back(fd, `/app/start/${task || 'write-pleading'}`);
  const docType = s(fd, 'docType') as drafts.DocType;
  if (!(docType in drafts.DOC_TYPES)) redirect(withMsg(b, 'error', 'Choose a document type that is available now.'));
  const matterMode = s(fd, 'matterMode') || 'existing';

  let matterId: string | undefined;
  if (matterMode === 'new') {
    const m = await attempt(() => matters.createMatter(ctx, { clientName: s(fd, 'client'), title: s(fd, 'mtitle'),
      clientKind: s(fd, 'clientKind') === 'organization' ? 'organization' : 'individual', opposingParty: s(fd, 'opposing'),
      practiceArea: s(fd, 'practice'), issues: s(fd, 'issues') }), b);
    matterId = m.matter_id;
    // If a later step fails, return to the guided screen with the new matter already selected.
    b = `/app/start/${task}?matter=${matterId}`;
  } else if (matterMode === 'existing') {
    matterId = s(fd, 'matter') || undefined;
    if (!matterId) redirect(withMsg(b, 'error', 'Choose the matter this document belongs to.'));
  }

  const factLines = s(fd, 'facts').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 30);
  if (matterId && factLines.length && fd.get('saveFacts') === 'on') {
    for (const statement of factLines) {
      await attempt(() => matters.addFact(ctx, matterId!, { statement, classification: 'allegation' }), b);
    }
  }
  const files = fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length && !matterId) redirect(withMsg(b, 'error', 'Supporting documents can only be attached to a matter.'));
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await attempt(() => matters.uploadDocument(ctx, matterId!, { filename: file.name, mime: file.type, bytes, rightsAttested: fd.get('attest') === 'on' }), b);
  }

  const w = fd.get('dnaWriting') === 'on', r = fd.get('dnaReasoning') === 'on';
  const dnaMode: dna.DnaMode = w && r ? 'combined' : w ? 'writing' : r ? 'reasoning' : 'neutral';
  const issues = s(fd, 'issues').trim();
  const out = await attempt(() => drafts.generateDraft(ctx, { matterId, docType, dnaMode, title: s(fd, 'title') || undefined,
    issuesText: issues || (matterId ? undefined : factLines.join('\n')), idempotencyKey: s(fd, 'idem') || undefined }), b);
  const saved = [factLines.length && matterId && fd.get('saveFacts') === 'on' ? `${factLines.length} fact(s) saved as unverified allegations` : '',
    files.length ? `${files.length} document(s) attached` : ''].filter(Boolean).join('; ');
  redirect(withMsg(`/app/drafts/${out.draftId}`, out.state === 'complete' ? 'ok' : 'error',
    out.state === 'complete' ? `Draft prepared${saved ? ` (${saved})` : ''}. Review every citation and fact before approval.` : out.message ?? 'Draft created without full AI analysis.'));
}

// ---------- Pilot: blinded recognition review (FR-036) ----------

export async function startBlindReviewAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = await attempt(() => pilot.startReview(ctx, s(fd, 'draft')), '/app/dna?tab=blind');
  redirect(`/app/dna/review/${id}`);
}

export async function submitBlindReviewAction(fd: FormData) {
  const ctx = await requireCtx();
  const id = s(fd, 'id');
  const r = await attempt(() => pilot.submitReview(ctx, id, {
    voice: s(fd, 'voice'), approach: s(fd, 'approach'), legalIssue: s(fd, 'legal'), effort: s(fd, 'effort'),
    comment: s(fd, 'comment'), consent: fd.get('consent') === 'yes',
  }), `/app/dna/review/${id}`);
  redirect(withMsg('/app/dna?tab=blind', 'ok', `Review recorded. The version written with your Lawyer DNA was ${r.personalizedWas}.`));
}
