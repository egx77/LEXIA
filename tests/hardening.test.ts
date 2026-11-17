import { beforeAll, describe, expect, it } from 'vitest';
import { createBackup, integrityChecks, openFromBackup, verifyBackup } from '../scripts/backup-core.mjs';
import { requestPasswordReset, resetPassword, signIn, THROTTLE } from '@/lib/accounts';
import { getDb, one, q } from '@/lib/db';
import { generateDraft, getDraft } from '@/lib/drafts';
import { FIXTURE_PASSWORD } from '@/lib/fixtures';
import { getMatter, listDocuments, listFacts, listMatters, listMatterTeam } from '@/lib/matters';
import { eligibleDrafts, getReview, recognitionSummary, startReview, submitReview } from '@/lib/pilot';
import { scorecard, scorecardRows } from '@/lib/scorecard';
import { listTasks } from '@/lib/tasks';
import { as, ASSISTANT, CRUZ, freshFixtures, LIM, REYES } from './helpers';

beforeAll(freshFixtures);

const answers = { voice: 'a', approach: 'a', legalIssue: 'none', effort: 'light', consent: true };

describe('S6 — sign-in throttling (FR-022)', () => {
  it('locks an email after repeated failures, even for the right password, without revealing whether it exists', async () => {
    for (let i = 0; i < THROTTLE.MAX_FAILURES - 1; i++) await expect(signIn(CRUZ, 'wrong-password-123')).rejects.toThrow(/incorrect/);
    await expect(signIn(CRUZ, 'wrong-password-123')).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(signIn(CRUZ, FIXTURE_PASSWORD)).rejects.toMatchObject({ code: 'rate_limited' });
    // An unregistered email is locked the same way, with the same message.
    for (let i = 0; i < THROTTLE.MAX_FAILURES - 1; i++) await expect(signIn('nobody@example.test', 'x'.repeat(12))).rejects.toThrow(/incorrect/);
    await expect(signIn('nobody@example.test', 'x'.repeat(12))).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('a password reset unlocks sign-in', async () => {
    const token = (await requestPasswordReset(CRUZ))!;
    await resetPassword(token, FIXTURE_PASSWORD);
    await expect(signIn(CRUZ, FIXTURE_PASSWORD)).resolves.toBeTruthy();
  });

  it('never writes passwords or session tokens into the audit log', async () => {
    const token = await signIn(REYES, FIXTURE_PASSWORD);
    const rows = await q<{ meta: unknown; target_id: string | null }>(`select meta, target_id from audit_events`);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(FIXTURE_PASSWORD);
    expect(dump).not.toContain(token);
  });
});

describe('S6 — broken-object authorization sweep (FD 07 §4 security)', () => {
  it('a lawyer in another firm gets “not found” for every Firm A object, by direct ID', async () => {
    const reyes = await as(REYES), lim = await as(LIM);
    const [m] = await listMatters(reyes);
    const d = await generateDraft(reyes, { matterId: m.id, docType: 'answer', dnaMode: 'neutral' });
    const denied = { code: expect.stringMatching(/not_found_or_denied|forbidden/) };
    await expect(getMatter(lim, m.id)).rejects.toMatchObject(denied);
    await expect(listFacts(lim, m.id)).rejects.toMatchObject(denied);
    await expect(listDocuments(lim, m.id)).rejects.toMatchObject(denied);
    await expect(listMatterTeam(lim, m.id)).rejects.toMatchObject(denied);
    await expect(getDraft(lim, d.draftId)).rejects.toMatchObject(denied);
    await expect(listTasks(lim, { matterId: m.id })).rejects.toMatchObject(denied);
    const logged = await one<{ n: number }>(`select count(*)::int as n from audit_events where actor_id = $1 and outcome = 'denied'`, [lim.userId]);
    expect(logged!.n).toBeGreaterThan(0);
  });
});

describe('S6 — FR-036 blinded recognition review (TC-030)', () => {
  it('shows the lawyer’s own DNA draft and its neutral twin unlabeled, and reveals only after a consented answer', async () => {
    const reyes = await as(REYES);
    const [m] = await listMatters(reyes);
    const neutral = await generateDraft(reyes, { matterId: m.id, docType: 'complaint', dnaMode: 'neutral' });
    const dnaDraft = await generateDraft(reyes, { matterId: m.id, docType: 'complaint', dnaMode: 'writing' });
    const ids = (await eligibleDrafts(reyes)).map((d) => d.id);
    expect(ids).toContain(dnaDraft.draftId);
    expect(ids).not.toContain(neutral.draftId);
    await expect(startReview(reyes, neutral.draftId)).rejects.toMatchObject({ code: 'not_found_or_denied' });

    const rid = await startReview(reyes, dnaDraft.draftId);
    expect(await startReview(reyes, dnaDraft.draftId)).toBe(rid); // resuming, not a second review
    const r = await getReview(reyes, rid);
    expect(JSON.stringify(r)).not.toMatch(/personaliz|neutral|dna|writing_version/i);
    const { draft } = await getDraft(reyes, dnaDraft.draftId);
    const neutralText = draft.neutral_content!.blocks.filter((b) => b.kind !== 'note').map((b) => b.text);
    expect([r.a.map((b) => b.text), r.b.map((b) => b.text)]).toContainEqual(neutralText);

    await expect(submitReview(reyes, rid, { ...answers, consent: false })).rejects.toMatchObject({ code: 'consent_required' });
    expect((await recognitionSummary(reyes)).completed).toBe(0);
    const out = await submitReview(reyes, rid, answers);
    expect(['A', 'B']).toContain(out.personalizedWas);
    await expect(submitReview(reyes, rid, answers)).rejects.toMatchObject({ code: 'conflict' });

    const s = await recognitionSummary(reyes);
    expect(s.completed).toBe(1);
    expect(out.personalizedWas === 'A' ? s.voice.personalized : s.voice.neutral).toBe(1);
  });

  it('nobody else can open a lawyer’s review, and the firm summary needs admin rights', async () => {
    const reyes = await as(REYES), cruz = await as(CRUZ), lim = await as(LIM), assistant = await as(ASSISTANT);
    const [d] = (await eligibleDrafts(reyes)).filter((x) => x.review_id);
    for (const other of [cruz, lim]) await expect(getReview(other, d.review_id!)).rejects.toMatchObject({ code: 'not_found_or_denied' });
    await expect(getReview(assistant, d.review_id!)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(recognitionSummary(assistant)).rejects.toMatchObject({ code: 'forbidden' });
    const rows = scorecardRows(await scorecard(reyes));
    expect(rows).toContainEqual(['blind_review.completed', 1]);
    expect(JSON.stringify(rows)).not.toContain('Reyes');
  });
});

describe('S6 — backup and restore (FD 07 §5 recovery gate)', () => {
  it('a backup restores with identical row counts and passes every scoped-access check', async () => {
    const db = await getDb();
    const { bytes, manifest } = await createBackup(db);
    const report = await verifyBackup(bytes, manifest);
    expect(report.steps.filter((s: { ok: boolean }) => !s.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(manifest.counts.audit_events).toBeGreaterThan(0);
  }, 60_000);

  it('detects a tampered backup and a cross-tenant row', async () => {
    const db = await getDb();
    const { bytes, manifest } = await createBackup(db);
    const tampered = await verifyBackup(bytes, { ...manifest, sha256: '0'.repeat(64) });
    expect(tampered.steps[0]).toMatchObject({ name: 'checksum matches manifest', ok: false });
    expect(tampered.ok).toBe(false);

    const copy = await openFromBackup(bytes);
    const d = (await copy.query<{ id: string; tenant_id: string }>(`select id, tenant_id from drafts where matter_id is not null limit 1`)).rows[0];
    const other = (await copy.query<{ id: string }>(`select id from tenants where id <> $1 limit 1`, [d.tenant_id])).rows[0];
    await copy.query(`update drafts set tenant_id = $1 where id = $2`, [other.id, d.id]);
    const checks = await integrityChecks(copy);
    expect(checks.find((c: { check: string }) => c.check.startsWith('drafts:'))!.violations).toBe(1);
    expect(checks.find((c: { check: string }) => c.check === 'audit_events: update is refused')!.violations).toBe(0);
    await copy.close();
  }, 60_000);
});
