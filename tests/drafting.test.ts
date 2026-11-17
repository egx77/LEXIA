import { beforeAll, describe, expect, it } from 'vitest';
import { setSimulation, setUsage, requestExternalAction } from '@/lib/ai/gateway';
import { one, q } from '@/lib/db';
import { addSample, consentState, decideFeedback, getSample, listFeedback, listProfiles, withdrawConsent, applicableProfiles } from '@/lib/dna';
import { approveDraft, generateDraft, getDraft, needsChecking, proposeDnaFeedback, saveDraftVersion } from '@/lib/drafts';
import { listMatters } from '@/lib/matters';
import { runResearch } from '@/lib/research';
import { exportDraftDocx } from '@/lib/word';
import { as, ASSISTANT, CRUZ, freshFixtures, LIM, REYES } from './helpers';

beforeAll(freshFixtures);

async function santos(email = REYES) {
  const ctx = await as(email);
  const m = (await listMatters(ctx)).find((x) => x.title.startsWith('Marina'))!;
  return { ctx, m };
}

describe('TC-011 research-to-memo, approval and export (FR-011, J-001)', () => {
  it('creates an editable memo, binds approval to the exact version, invalidates on edit', async () => {
    const { ctx, m } = await santos();
    const { queryId } = await runResearch(ctx, { question: 'Whether Bayani Trading incurred delay in delivery after demand?', matterId: m.id });
    const { draftId } = await generateDraft(ctx, { matterId: m.id, docType: 'memorandum', dnaMode: 'neutral', researchQueryId: queryId });
    const { draft, version } = await getDraft(ctx, draftId);
    expect(version.content.blocks.some((b) => b.claim?.status === 'verified')).toBe(true);
    await expect(approveDraft(await as(ASSISTANT), draftId, { version: draft.current_version, acknowledgeOpenItems: true })).rejects.toThrow(/role does not permit/);
    await expect(approveDraft(ctx, draftId, { version: draft.current_version, acknowledgeOpenItems: false })).rejects.toThrow(/need checking/);
    const hash = await approveDraft(ctx, draftId, { version: draft.current_version, acknowledgeOpenItems: true });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const docx = await exportDraftDocx(ctx, draftId);
    expect(docx.bytes[0]).toBe(0x50); // PK zip
    expect(docx.filename).not.toMatch(/DRAFT/);
    const target = version.content.blocks.find((b) => b.kind === 'para')!;
    await saveDraftVersion(ctx, draftId, { baseVersion: 1, texts: { [target.id]: target.text + ' Edited.' } });
    const after = await getDraft(ctx, draftId);
    expect(after.draft.status).toBe('draft');
    expect(after.approval).toBeUndefined();
    expect((await exportDraftDocx(ctx, draftId)).filename).toMatch(/DRAFT/);
    await expect(saveDraftVersion(ctx, draftId, { baseVersion: 1, texts: {} })).rejects.toThrow(/changed/);
  });
});

describe('TC-013 / TC-027 pleading and DNA modes (FR-013, FR-033, J-002)', () => {
  it('keeps fact labels, offers neutral comparison, and modes change only style/structure', async () => {
    const { ctx, m } = await santos();
    const { draftId } = await generateDraft(ctx, { matterId: m.id, docType: 'complaint', dnaMode: 'combined' });
    const { draft, version } = await getDraft(ctx, draftId);
    const text = version.content.blocks.map((b) => b.text).join('\n');
    expect(draft.dna_mode).toBe('combined');
    expect(text).toMatch(/COMES NOW/);
    expect(text).toMatch(/WHEREFORE, premises considered/);
    expect(text).toMatch(/\[Allegation\]/);
    expect(text).toMatch(/\[Evidence\]/);
    expect(text).toMatch(/UNVERIFIED/);
    expect(version.content.blocks.some((b) => b.section === 'counter')).toBe(true);
    const neutral = draft.neutral_content!.blocks.map((b) => b.text).join('\n');
    expect(neutral).not.toMatch(/COMES NOW/);
    // Same legal support in both: citations identical sets
    const cites = (c: typeof version.content) => new Set(c.blocks.filter((b) => b.section === 'discussion').flatMap((b) => b.claim?.citations.map((x) => x.passage_id) ?? []));
    expect([...cites(version.content)].sort()).toEqual([...cites(draft.neutral_content!)].sort());
    expect(text).not.toMatch(/file(d)? with the court by LEXIA/i);

    const cruz = await as(CRUZ);
    const { draftId: d2 } = await generateDraft(cruz, { matterId: m.id, docType: 'complaint', dnaMode: 'combined' });
    const t2 = (await getDraft(cruz, d2)).version.content.blocks.map((b) => b.text).join('\n');
    expect(t2).not.toMatch(/COMES NOW/);
    expect(t2).toMatch(/Risks and gaps/);
  });

  it('assistants can draft but DNA is never applied for them', async () => {
    const { ctx, m } = await santos(ASSISTANT);
    const { draftId } = await generateDraft(ctx, { matterId: m.id, docType: 'answer', dnaMode: 'combined' });
    expect((await getDraft(ctx, draftId)).draft.dna_mode).toBe('neutral');
  });
});

describe('TC-021 AI continuity (FR-021, AC-005)', () => {
  it('quota exhaustion mid-draft leaves a recoverable partial draft that can be edited and exported', async () => {
    const { ctx, m } = await santos();
    const ent = (await one<{ ai_units_quota: number }>(`select ai_units_quota from entitlements where tenant_id = $1`, [ctx.tenantId]))!;
    await setUsage(ctx, ent.ai_units_quota - 2); // enough for exactly one compose step
    const out = await generateDraft(ctx, { matterId: m.id, docType: 'complaint', dnaMode: 'neutral' });
    expect(out.state).toBe('partial');
    const { version } = await getDraft(ctx, out.draftId);
    expect(version.content.blocks.some((b) => b.text.includes('Analysis pending'))).toBe(true);
    const para = version.content.blocks.find((b) => b.kind === 'para')!;
    await saveDraftVersion(ctx, out.draftId, { baseVersion: 1, texts: { [para.id]: para.text + ' Manual note.' } });
    expect((await exportDraftDocx(ctx, out.draftId)).bytes.length).toBeGreaterThan(1000);
    const run = await one<{ status: string; quota_status: string }>(`select status, quota_status from ai_runs where tenant_id = $1 order by created_at desc limit 1`, [ctx.tenantId]);
    expect(run).toEqual({ status: 'partial', quota_status: 'exhausted' });
    await setUsage(ctx, 0);
  });

  it('provider outage produces a manual template, never a fabricated draft', async () => {
    const { ctx, m } = await santos();
    await setSimulation(ctx, 'outage');
    const out = await generateDraft(ctx, { matterId: m.id, docType: 'position_paper', dnaMode: 'neutral' });
    await setSimulation(ctx, 'none');
    expect(out.state).toBe('manual');
    const { version } = await getDraft(ctx, out.draftId);
    expect(version.content.blocks.filter((b) => b.claim?.status === 'verified').length).toBe(0);
  });

  it('external actions are refused (FD 06 §8)', async () => {
    const r = await requestExternalAction(await as(REYES), { type: 'file_pleading' });
    expect(r.performed).toBe(false);
  });
});

describe('TC-015 / TC-022 matter isolation for drafts', () => {
  it('another tenant cannot open, export or draft into the matter', async () => {
    const { ctx, m } = await santos();
    const { draftId } = await generateDraft(ctx, { matterId: m.id, docType: 'demand_letter', dnaMode: 'neutral' });
    const lim = await as(LIM);
    await expect(getDraft(lim, draftId)).rejects.toThrow();
    await expect(exportDraftDocx(lim, draftId)).rejects.toThrow();
    await expect(generateDraft(lim, { matterId: m.id, docType: 'complaint', dnaMode: 'neutral' })).rejects.toThrow('You do not have access to this matter.');
  });
});

describe('TC-028 sample isolation (FR-034, AC-010)', () => {
  it('a lawyer cannot read another lawyer’s sample or profile', async () => {
    const reyes = await as(REYES);
    const cruz = await as(CRUZ);
    const [s] = await q<{ id: string }>(`select id from dna_samples where lawyer_id = $1 limit 1`, [reyes.userId]);
    await expect(getSample(cruz, s.id)).rejects.toThrow(/not found/);
    const cruzProfile = (await listProfiles(cruz, 'writing'))[0];
    const reyesProfile = (await listProfiles(reyes, 'writing'))[0];
    expect(cruzProfile.id).not.toBe(reyesProfile.id);
    expect((await listProfiles(await as(LIM), 'writing')).length).toBe(0);
  });
});

describe('TC-029 feedback accept/reject/undo (FR-035, AC-011)', () => {
  it('rejected proposals never change the profile; accept creates a version; undo restores', async () => {
    const { ctx, m } = await santos();
    const { draftId } = await generateDraft(ctx, { matterId: m.id, docType: 'complaint', dnaMode: 'combined' });
    const { version } = await getDraft(ctx, draftId);
    // Lawyer rewrites the opening plainly and deletes the counterargument section.
    const texts: Record<string, string> = {};
    for (const b of version.content.blocks) if (b.section === 'opening') texts[b.id] = 'Plaintiff Marina Santos, through counsel, states:';
    const deleted = version.content.blocks.filter((b) => b.section === 'counter').map((b) => b.id);
    await saveDraftVersion(ctx, draftId, { baseVersion: 1, texts, deleted });
    const before = (await listProfiles(ctx, 'writing')).find((p) => p.status === 'active')!;
    expect(await proposeDnaFeedback(ctx, draftId)).toBeGreaterThan(0);
    const props = (await listFeedback(ctx)).filter((f) => f.draft_id === draftId);
    const w = props.find((p) => p.type === 'writing')!;
    const r = props.find((p) => p.type === 'reasoning')!;
    expect(w.proposal.changes.some((c) => c.key === 'opening')).toBe(true);
    await decideFeedback(ctx, w.id, 'reject');
    const afterReject = (await listProfiles(ctx, 'writing')).find((p) => p.status === 'active')!;
    expect(afterReject.version).toBe(before.version);
    const rBefore = (await listProfiles(ctx, 'reasoning')).find((p) => p.status === 'active')!;
    const v = await decideFeedback(ctx, r.id, 'accept');
    expect(v).toBe(rBefore.version + 1);
    const accepted = (await listProfiles(ctx, 'reasoning')).find((p) => p.status === 'active')!;
    expect(accepted.traits.find((t) => t.key === 'counterarguments')!.value).toBe(false);
    await decideFeedback(ctx, r.id, 'undo');
    const undone = (await listProfiles(ctx, 'reasoning')).find((p) => p.status === 'active')!;
    expect(undone.traits.find((t) => t.key === 'counterarguments')!.value).toBe(true);
    await expect(decideFeedback(ctx, w.id, 'accept')).rejects.toThrow(/pending/);
  });
});

describe('TC-012 consent withdrawal (FR-012, AC-004)', () => {
  it('withdrawal stops profile use → neutral; new samples need consent', async () => {
    const { ctx, m } = await santos();
    await withdrawConsent(ctx, 'writing');
    expect((await consentState(ctx)).writing).toBe(false);
    const ap = await applicableProfiles(ctx, 'combined');
    expect(ap.writing).toBeUndefined();
    expect(ap.effective).toBe('reasoning');
    const { draftId } = await generateDraft(ctx, { matterId: m.id, docType: 'complaint', dnaMode: 'writing' });
    const d = await getDraft(ctx, draftId);
    expect(d.draft.dna_mode).toBe('neutral');
    expect(d.version.content.personalization.notes.join(' ')).toMatch(/consent not active/);
    await expect(addSample(ctx, { title: 't', text: 'x'.repeat(300), purposes: ['writing'], provenance: 'p', confidentiality: 'non_confidential', authorityAttested: true })).rejects.toThrow(/Consent/);
    const revoked = await q(`select 1 from dna_profiles where lawyer_id = $1 and type = 'writing' and status = 'active'`, [ctx.userId]);
    expect(revoked.length).toBe(0);
    expect(needsChecking(d.version.content).length).toBeGreaterThan(0);
  });
});
