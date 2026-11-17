import { beforeAll, describe, expect, it } from 'vitest';
import { setSimulation, setUsage } from '@/lib/ai/gateway';
import { q } from '@/lib/db';
import { listMatters } from '@/lib/matters';
import { runResearch } from '@/lib/research';
import { ingestSource, listSources, registerSource, searchPassages, updateSourceRights } from '@/lib/sources';
import { as, CRUZ, freshFixtures, LIM, QA, REYES } from './helpers';

beforeAll(freshFixtures);

describe('TC-006 rights enforcement (FR-006, DEV-101)', () => {
  it('unknown/restricted rights block ingestion and are logged', async () => {
    const logs = await q<{ outcome: string }>(`select outcome from ingestion_log where outcome = 'blocked_rights'`);
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const qa = await as(QA);
    const id = await registerSource(qa, { scope: 'core', title: 'Index-only', authority: 'x', sourceType: 'reference', rightsState: 'cleared', permittedUses: ['display'] });
    await expect(ingestSource(qa, id, { versionLabel: 'v', text: 'Some long enough legal text about delay and damages here.' })).rejects.toThrow(/Ingestion blocked/);
  });

  it('only QA editors manage the shared core; lawyers need rights attestation for reference uploads', async () => {
    const reyes = await as(REYES);
    await expect(registerSource(reyes, { scope: 'core', title: 't', authority: 'a', sourceType: 'statute', rightsState: 'cleared', permittedUses: ['ingest'] })).rejects.toThrow(/role does not permit/);
    await expect(registerSource(reyes, { scope: 'firm', title: 't', authority: 'a', sourceType: 'reference', rightsState: 'cleared', permittedUses: ['ingest'] })).rejects.toThrow(/Confirm you hold/);
  });
});

describe('TC-007 provenance/hash (FR-007)', () => {
  it('records hash, detects duplicates and flags failed extraction', async () => {
    const qa = await as(QA);
    const id = await registerSource(qa, { scope: 'core', title: 'Dup test', authority: 'x', sourceType: 'reference', rightsState: 'cleared', permittedUses: ['ingest', 'index', 'display'] });
    const text = 'Art. 1. A synthetic provision long enough to be a passage of text.';
    const a = await ingestSource(qa, id, { versionLabel: 'v1', text });
    const b = await ingestSource(qa, id, { versionLabel: 'v1-again', text });
    expect(b.duplicate).toBe(true);
    expect(b.versionId).toBe(a.versionId);
    await expect(ingestSource(qa, id, { versionLabel: 'empty', text: '   ' })).rejects.toThrow(/Extraction failed/);
    const outcomes = (await q<{ outcome: string }>(`select outcome from ingestion_log where source_id = $1 order by created_at`, [id])).map((r) => r.outcome);
    expect(outcomes).toEqual(['ingested', 'duplicate', 'extraction_failed']);
  });
});

describe('TC-008 permissions before ranking (FR-008)', () => {
  it('never returns another tenant’s firm library, unassigned matter sources, restricted or suspended sources', async () => {
    const reyes = await as(REYES);
    const hits = await searchPassages(reyes, { query: 'fortuitous event delay delivery damages', mode: 'hybrid', limit: 50 });
    const titles = hits.map((h) => h.source_title).join(' | ');
    expect(titles).not.toMatch(/Bayani internal playbook/);
    expect(titles).not.toMatch(/restricted licence|rights unknown|Expired licence/);
    expect(hits.length).toBeGreaterThan(0);
    const lim = await as(LIM);
    const limHits = await searchPassages(lim, { query: 'reference memo delivery schedule', mode: 'keyword', limit: 50 });
    expect(limHits.map((h) => h.source_title).join(' ')).not.toMatch(/Client-provided reference memo/);
    const cruz = await as(CRUZ);
    expect((await listSources(cruz)).some((s) => s.scope === 'matter')).toBe(true); // assigned to Santos matter
  });

  it('keyword search works with AI unavailable', async () => {
    const reyes = await as(REYES);
    await setSimulation(reyes, 'outage');
    const hits = await searchPassages(reyes, { query: 'rescission reciprocal', mode: 'keyword' });
    expect(hits[0].locator).toBe('Art. 904');
    await setSimulation(reyes, 'none');
  });
});

describe('TC-009 freshness warnings (FR-009)', () => {
  it('flags stale check dates, unknown effective dates and unverified treatment', async () => {
    const reyes = await as(REYES);
    const hits = await searchPassages(reyes, { query: 'typhoon fortuitous event court held', mode: 'keyword' });
    const dec = hits.find((h) => h.source_title.includes('synthetic decision'))!;
    expect(dec.warnings.join(' ')).toMatch(/needs review; last checked/);
    expect(dec.warnings.join(' ')).toMatch(/Effective date unknown/);
    expect(dec.warnings.join(' ')).toMatch(/not verified/);
  });
});

describe('TC-010 / TC-014 verified research and citation QA (FR-010, FR-014, AC-001)', () => {
  it('every verified claim resolves to an exact authorized passage', async () => {
    const reyes = await as(REYES);
    const { result } = await runResearch(reyes, { question: 'Whether the seller incurred delay in delivery after demand?' });
    const verified = result.claims.filter((c) => c.status === 'verified');
    expect(verified.length).toBeGreaterThan(0);
    for (const c of verified) {
      const [p] = await q<{ text: string }>(`select text from passages where id = $1`, [c.citations[0].passage_id]);
      expect(p.text.includes(c.citations[0].quote)).toBe(true);
    }
  });

  it('a fabricated citation never receives a verified badge', async () => {
    const reyes = await as(REYES);
    await setSimulation(reyes, 'fabricated_citation');
    const { result } = await runResearch(reyes, { question: 'Whether damages may be recovered for delay?' });
    await setSimulation(reyes, 'none');
    const fake = result.claims.find((c) => c.text.includes('Imaginary Holdings'))!;
    expect(fake.status).toBe('unverified');
    expect(fake.reasons.join(' ')).toMatch(/does not resolve/);
  });

  it('no permitted source → unverified, never fabricated', async () => {
    const { result } = await runResearch(await as(REYES), { question: 'Whether maritime salvage liens attach to aircraft?' });
    expect(result.claims.every((c) => c.status === 'unverified' && c.citations.length === 0)).toBe(true);
  });

  it('prompt-injection text in a retrieved source is treated as data', async () => {
    const reyes = await as(REYES);
    const [m] = (await listMatters(reyes)).filter((x) => x.title.startsWith('Marina'));
    const { result } = await runResearch(reyes, { question: 'What was the revised delivery schedule in the supply agreement?', matterId: m.id });
    expect(result.limitations.join(' ')).toMatch(/instruction-like text/);
    expect(JSON.stringify(result.claims)).not.toMatch(/IGNORE PREVIOUS/);
  });

  it('research with exhausted quota returns keyword hits only (FR-021)', async () => {
    const reyes = await as(REYES);
    await setUsage(reyes, 100000);
    const { result } = await runResearch(reyes, { question: 'Whether delay requires demand?' });
    expect(result.ai).toBe('quota_exhausted');
    expect(result.mode).toBe('keyword');
    expect(result.hits.length).toBeGreaterThan(0);
    await setUsage(reyes, 0);
  });

  it('revoking rights stops serving a source', async () => {
    const qa = await as(QA);
    const reyes = await as(REYES);
    const src = (await listSources(qa)).find((s) => s.title.includes('Labor Code'))!;
    await updateSourceRights(qa, src.id, 'suspended', []);
    const hits = await searchPassages(reyes, { query: 'dismissed procedural due process', mode: 'keyword' });
    expect(hits.some((h) => h.source_id === src.id)).toBe(false);
    await updateSourceRights(qa, src.id, 'cleared', ['ingest', 'index', 'ai_processing', 'display', 'redistribute']);
  });
});
