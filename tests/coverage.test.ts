import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { registerAccount, resolveSession, signIn, verifyEmail } from '@/lib/accounts';
import { setSimulation } from '@/lib/ai/gateway';
import { chatHistory, sendChat } from '@/lib/chat';
import { one, q } from '@/lib/db';
import { generateDraft } from '@/lib/drafts';
import { listMatters } from '@/lib/matters';
import { acceptPolicies, pendingAcceptances } from '@/lib/policies';
import { runResearch } from '@/lib/research';
import { scorecard } from '@/lib/scorecard';
import { as, CRUZ, freshFixtures, REYES } from './helpers';

beforeAll(freshFixtures);

describe('TC-017 conversation: citations and fallback (FR-017)', () => {
  it('answers through grounded research, falls back to keyword search in an outage, and keeps chats per user', async () => {
    const reyes = await as(REYES), cruz = await as(CRUZ);
    await sendChat(reyes, 'Is demand required before the debtor is in delay?');
    let h = await chatHistory(reyes);
    const reply = h.at(-1)!;
    expect(reply.role).toBe('assistant');
    expect(reply.content.research_id).toBeTruthy();
    for (const c of reply.content.result!.claims) expect(['verified', 'needs_checking', 'unverified']).toContain(c.status);

    await setSimulation(reyes, 'outage');
    await sendChat(reyes, 'Is demand required before the debtor is in delay?');
    h = await chatHistory(reyes);
    expect(h.at(-1)!.content.text).toMatch(/keyword search instead/);
    await setSimulation(reyes, 'none');
    expect(await chatHistory(cruz)).toEqual([]);
  });
});

describe('TC-019 entitlements: idempotency and no charging (FR-019)', () => {
  it('a retried request with the same idempotency key is refused, so it is metered once; nothing is charged', async () => {
    const reyes = await as(REYES);
    const key = 'retry-test-0001';
    await runResearch(reyes, { question: 'Requisites of extrajudicial demand', idempotencyKey: key });
    await expect(runResearch(reyes, { question: 'Requisites of extrajudicial demand', idempotencyKey: key })).rejects.toMatchObject({ code: 'conflict' });
    const runs = await q(`select id from ai_runs where tenant_id = $1 and idempotency_key = $2`, [reyes.tenantId, key]);
    expect(runs).toHaveLength(1);
    const ent = await one<{ payment_state: string }>(`select payment_state from entitlements where tenant_id = $1`, [reyes.tenantId]);
    expect(ent!.payment_state).not.toMatch(/paid|charged|active_billing/);
  });
});

describe('TC-020 online-first: no private offline cache (FR-020, DEV-106)', () => {
  it('the service worker never caches /app or /api, and private responses are marked no-store', async () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    const precache = /const PRECACHE = \[([^\]]*)\]/.exec(sw)![1];
    expect(precache).not.toMatch(/\/app|\/api/);
    const appBranch = sw.split("url.pathname.startsWith('/app')")[1].split('if (isStatic(url))')[0];
    expect(appBranch).not.toMatch(/cache\.put|c\.put|caches\.open/);
    const headers = await nextConfig.headers!();
    const priv = headers.find((h) => h.source.includes('app') && h.source.includes('api'))!;
    expect(priv.headers).toContainEqual({ key: 'Cache-Control', value: 'no-store, private' });
  });
});

describe('TC-023 legal policies: versioned consent (FR-023)', () => {
  it('a new user must accept every current policy version; acceptance is audited; drafts are labelled unreviewed', async () => {
    const { verifyToken } = await registerAccount({ name: 'Test Lawyer (fictional)', email: 'policy.test@lexia.test', password: 'Lexia-Pilot-2026!', firmName: 'Policy Test Firm (fictional)' });
    await verifyEmail(verifyToken);
    const ctx = (await resolveSession(await signIn('policy.test@lexia.test', 'Lexia-Pilot-2026!')))!;
    const pending = await pendingAcceptances(ctx.userId);
    expect(pending.map((p) => p.kind).sort()).toEqual(['ai_disclosure', 'privacy', 'terms']);
    for (const p of pending) expect(p.version).toMatch(/draft/); // not presented as legally reviewed
    await expect(acceptPolicies(ctx, [pending[0].id])).rejects.toThrow(/accept each/);
    await acceptPolicies(ctx, pending.map((p) => p.id));
    expect(await pendingAcceptances(ctx.userId)).toEqual([]);
    const a = await one<{ meta: { versions: string[] } }>(`select meta from audit_events where actor_id = $1 and action = 'policy.accept'`, [ctx.userId]);
    expect(a!.meta.versions).toHaveLength(3);
  });
});

describe('TC-024 scorecard numerators and evidence (FR-024)', () => {
  it('counts add up to their denominators, match the drafts, and are admin-only', async () => {
    const reyes = await as(REYES), cruz = await as(CRUZ);
    const [m] = await listMatters(reyes);
    await generateDraft(reyes, { matterId: m.id, docType: 'complaint', dnaMode: 'neutral' });
    const s = await scorecard(reyes);
    expect(s.citations.verified + s.citations.needs + s.citations.unverified).toBe(s.citations.total);
    const d = await one<{ n: number }>(`select count(*)::int as n from drafts where tenant_id = $1`, [reyes.tenantId]);
    expect(s.drafts.total).toBe(d!.n);
    expect(s.editing.changedBlocks).toBeLessThanOrEqual(s.editing.aiBlocks);
    expect(s.totalUnits).toBe(s.runs.reduce((a, r) => a + r.units, 0));
    await expect(scorecard(cruz)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
