import { audit } from './audit';
import { assertMatterAccess, requirePerm, type Ctx } from './authz';
import { sha256 } from './crypto';
import { one, q, tx } from './db';
import { DomainError } from './errors';

/**
 * Lawyer DNA — FR-012, FR-031..FR-036, FD 06 §4.
 * Writing DNA = observable voice/format preferences. Reasoning DNA = observable analytical ordering preferences.
 * Neither infers mental states, neither can override law/evidence/approval, both are opt-in, per-lawyer,
 * versioned and revocable. No model training: profiles are editable statements applied by deterministic rules.
 */

export type DnaType = 'writing' | 'reasoning';
export type DnaMode = 'neutral' | 'writing' | 'reasoning' | 'combined';
export const DNA_NOTICE_VERSION = 'dna-notice-0.1-draft (pending legal review)';

export interface Evidence { sample_id: string; sample_title: string; note: string }
export interface Trait {
  key: string; label: string; value: string | boolean; statement: string;
  confidence: 'low' | 'medium' | 'high'; evidence: Evidence[]; enabled: boolean;
}

/** Allowed trait keys and values — the profile is an editable, bounded preference set. */
export const TRAIT_SPEC: Record<DnaType, Record<string, { label: string; values: (string | boolean)[]; describe: (v: string | boolean) => string }>> = {
  writing: {
    heading_style: { label: 'Heading style', values: ['upper_roman', 'upper_plain', 'title_arabic'],
      describe: (v) => ({ upper_roman: 'Headings in UPPERCASE with Roman numerals (I., II., …)', upper_plain: 'Headings in UPPERCASE without numbering', title_arabic: 'Headings in Title Case with Arabic numerals (1., 2., …)' }[String(v)] ?? String(v)) },
    opening: { label: 'Opening formula', values: ['comes_now', 'plain'],
      describe: (v) => v === 'comes_now' ? 'Opens pleadings with a formal “COMES NOW … respectfully states” formula' : 'Opens with a short plain statement of the party and purpose' },
    prayer: { label: 'Prayer formula', values: ['wherefore_premises', 'plain'],
      describe: (v) => v === 'wherefore_premises' ? 'Closes with “WHEREFORE, premises considered, it is respectfully prayed …”' : 'Closes with a plain “Relief sought” section' },
    sentence_length: { label: 'Sentence length', values: ['concise', 'moderate', 'expansive'],
      describe: (v) => ({ concise: 'Prefers short, direct sentences', moderate: 'Uses moderate-length sentences', expansive: 'Uses long, elaborated sentences with formal connectives' }[String(v)] ?? String(v)) },
    citation_style: { label: 'Citation presentation', values: ['lead_in', 'parenthetical'],
      describe: (v) => v === 'lead_in' ? 'Introduces authority first (“Under Article X of …, …”)' : 'States the proposition then cites in parentheses' },
    formality: { label: 'Register', values: ['formal', 'plain'],
      describe: (v) => v === 'formal' ? 'Formal register (“this Honorable Court”, “the undersigned counsel”)' : 'Plain-language register' },
  },
  reasoning: {
    procedural_first: { label: 'Procedural thresholds first', values: [true, false],
      describe: (v) => v ? 'Addresses procedural thresholds (jurisdiction, prescription, venue, cause of action) before the merits' : 'Leads with the merits; procedural points follow' },
    analysis_order: { label: 'Analysis order', values: ['facts_then_law', 'law_then_facts'],
      describe: (v) => v === 'facts_then_law' ? 'Presents the facts and evidence before applying the law' : 'States the governing law before applying it to the facts' },
    counterarguments: { label: 'Counterarguments', values: [true, false],
      describe: (v) => v ? 'Anticipates and answers opposing arguments explicitly' : 'Does not include a separate counterargument section' },
    risk_framing: { label: 'Risk framing', values: [true, false],
      describe: (v) => v ? 'Closes analysis with risks, gaps and uncertainties' : 'No separate risk section' },
    authority_hierarchy: { label: 'Authority hierarchy', values: [true, false],
      describe: (v) => v ? 'Orders authorities by hierarchy (Constitution → statute → rules → jurisprudence → issuances)' : 'Orders authorities by relevance' },
  },
};

// ---- Consent (FR-012, FR-034) ----

export async function consentState(ctx: Ctx) {
  const rows = await q<{ purpose: DnaType; granted_at: Date; withdrawn_at: Date | null; notice_version: string }>(
    `select distinct on (purpose) purpose, granted_at, withdrawn_at, notice_version from dna_consents
      where tenant_id = $1 and lawyer_id = $2 order by purpose, granted_at desc`, [ctx.tenantId, ctx.userId]);
  const active = (p: DnaType) => rows.some((r) => r.purpose === p && !r.withdrawn_at);
  return { writing: active('writing'), reasoning: active('reasoning'), history: rows };
}

export async function consentHistory(ctx: Ctx) {
  return q<{ purpose: DnaType; granted_at: Date; withdrawn_at: Date | null; notice_version: string }>(
    `select purpose, granted_at, withdrawn_at, notice_version from dna_consents where tenant_id = $1 and lawyer_id = $2 order by granted_at desc`,
    [ctx.tenantId, ctx.userId]);
}

export async function grantConsent(ctx: Ctx, purpose: DnaType) {
  await requirePerm(ctx, 'dna');
  const st = await consentState(ctx);
  if (st[purpose]) return;
  await q(`insert into dna_consents(tenant_id, lawyer_id, purpose, notice_version) values ($1,$2,$3,$4)`, [ctx.tenantId, ctx.userId, purpose, DNA_NOTICE_VERSION]);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'dna.consent_grant', purpose, meta: { notice: DNA_NOTICE_VERSION } });
}

/**
 * Withdrawal stops use immediately: active profile → revoked, samples drop the purpose (withdrawn if none left).
 * Physical deletion follows the approved retention policy (DEV-202 pending) — not promised as instant erasure.
 */
export async function withdrawConsent(ctx: Ctx, purpose: DnaType) {
  await requirePerm(ctx, 'dna');
  await tx(async (t) => {
    await q(`update dna_consents set withdrawn_at = now() where tenant_id = $1 and lawyer_id = $2 and purpose = $3 and withdrawn_at is null`, [ctx.tenantId, ctx.userId, purpose], t);
    await q(`update dna_profiles set status = 'revoked' where tenant_id = $1 and lawyer_id = $2 and type = $3 and status in ('active','disabled','draft')`, [ctx.tenantId, ctx.userId, purpose], t);
    await q(`update dna_samples set purposes = array_remove(purposes, $3) where tenant_id = $1 and lawyer_id = $2`, [ctx.tenantId, ctx.userId, purpose], t);
    await q(`update dna_samples set status = 'withdrawn', withdrawn_at = now() where tenant_id = $1 and lawyer_id = $2 and cardinality(purposes) = 0 and status = 'active'`, [ctx.tenantId, ctx.userId], t);
    await q(`update dna_feedback set status = 'rejected', decided_at = now() where tenant_id = $1 and lawyer_id = $2 and type = $3 and status = 'proposed'`, [ctx.tenantId, ctx.userId, purpose], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'dna.consent_withdraw', purpose, meta: { deletion: 'queued_per_retention_policy_pending_DEV-202' } }, t);
  });
}

// ---- Samples (FR-034) ----

export interface SampleInput {
  title: string; text: string; purposes: DnaType[]; matterId?: string; practiceArea?: string; docType?: string;
  provenance: string; confidentiality: 'non_confidential' | 'confidential_permitted' | 'public_record'; authorityAttested: boolean;
}

export async function addSample(ctx: Ctx, input: SampleInput) {
  await requirePerm(ctx, 'dna');
  if (!input.authorityAttested) throw new DomainError('rights_blocked', 'Confirm you have authority to use this document as a writing sample.');
  if (!input.purposes.length) throw new DomainError('invalid_input', 'Choose Writing DNA and/or Reasoning DNA analysis.');
  const consent = await consentState(ctx);
  for (const p of input.purposes) if (!consent[p]) throw new DomainError('consent_required', `Consent to ${p === 'writing' ? 'Writing' : 'Reasoning'} DNA analysis is required first.`);
  const text = input.text.replace(/\r\n/g, '\n').trim();
  if (text.length < 200) throw new DomainError('invalid_input', 'Sample text is too short to analyze (minimum 200 characters).');
  if (!input.provenance.trim()) throw new DomainError('invalid_input', 'Describe where this sample came from.');
  if (input.matterId) await assertMatterAccess(ctx, input.matterId);
  const hash = sha256(text);
  const dup = await one(`select 1 from dna_samples where lawyer_id = $1 and sha256 = $2 and status = 'active'`, [ctx.userId, hash]);
  if (dup) throw new DomainError('conflict', 'This sample has already been added.');
  const r = (await one<{ id: string }>(
    `insert into dna_samples(tenant_id, lawyer_id, matter_id, title, practice_area, doc_type, provenance, confidentiality, authority_attested, purposes, text, sha256)
     values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11)
     on conflict (lawyer_id, sha256) do update set status = 'active', withdrawn_at = null, purposes = excluded.purposes returning id`,
    [ctx.tenantId, ctx.userId, input.matterId || null, input.title.trim() || 'Untitled sample', input.practiceArea?.trim() || null,
      input.docType?.trim() || null, input.provenance.trim(), input.confidentiality, input.purposes, text, hash]))!;
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'dna.sample_add', targetType: 'dna_sample', targetId: r.id, meta: { purposes: input.purposes, confidentiality: input.confidentiality } });
  return r.id;
}

export async function withdrawSample(ctx: Ctx, sampleId: string) {
  await requirePerm(ctx, 'dna');
  const r = await one(`update dna_samples set status = 'withdrawn', withdrawn_at = now() where id = $1 and lawyer_id = $2 and tenant_id = $3 returning 1`, [sampleId, ctx.userId, ctx.tenantId]);
  if (!r) throw new DomainError('not_found_or_denied', 'Sample not found.');
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'dna.sample_withdraw', targetType: 'dna_sample', targetId: sampleId });
}

/** Lawyer-only: samples are always filtered by the requesting lawyer — never by an ID alone (AC-010). */
export async function listSamples(ctx: Ctx) {
  await requirePerm(ctx, 'dna');
  return q<{ id: string; title: string; practice_area: string | null; doc_type: string | null; provenance: string; confidentiality: string;
    purposes: DnaType[]; status: string; matter_id: string | null; chars: number; created_at: Date }>(
    `select id, title, practice_area, doc_type, provenance, confidentiality, purposes, status, matter_id, length(text) as chars, created_at
       from dna_samples where tenant_id = $1 and lawyer_id = $2 order by created_at desc`, [ctx.tenantId, ctx.userId]);
}

export async function getSample(ctx: Ctx, sampleId: string) {
  await requirePerm(ctx, 'dna');
  const s = await one<{ id: string; title: string; text: string; status: string }>(
    `select id, title, text, status from dna_samples where id = $1 and tenant_id = $2 and lawyer_id = $3`, [sampleId, ctx.tenantId, ctx.userId]);
  if (!s) {
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'dna.sample_read', targetType: 'dna_sample', targetId: sampleId, outcome: 'denied' });
    throw new DomainError('not_found_or_denied', 'Sample not found.');
  }
  return s;
}

// ---- Analysis (deterministic, observable features only) ----

const PROC = /\b(jurisdiction|prescription|prescribed|venue|cause of action|exhaustion|forum shopping|litis pendentia|res judicata|lack of standing|premature)\b/gi;

function sentences(t: string) { return t.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).length > 3); }

export function analyzeWriting(text: string): Record<string, string> {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const headingLines = lines.filter((l) => l.length < 90 && !/[.;,]$/.test(l));
  const upper = headingLines.filter((l) => l === l.toUpperCase() && /[A-Z]{3}/.test(l)).length;
  const roman = headingLines.filter((l) => /^(I|II|III|IV|V|VI|VII|VIII|IX|X)\.\s/.test(l)).length;
  const sents = sentences(text);
  const avg = sents.reduce((a, s) => a + s.split(/\s+/).length, 0) / Math.max(1, sents.length);
  const leadIn = (text.match(/\b(under|pursuant to|as provided in)\s+(art(icle)?\.?|sec(tion)?\.?|rule)\s/gi) ?? []).length;
  const paren = (text.match(/\((art(icle)?\.?|sec(tion)?\.?|rule|g\.r\.)\s/gi) ?? []).length;
  return {
    heading_style: upper >= 2 ? (roman >= 1 ? 'upper_roman' : 'upper_plain') : 'title_arabic',
    opening: /\bcomes? now\b/i.test(text) ? 'comes_now' : 'plain',
    prayer: /wherefore,?\s+premises considered/i.test(text) ? 'wherefore_premises' : 'plain',
    sentence_length: avg < 18 ? 'concise' : avg > 28 ? 'expansive' : 'moderate',
    citation_style: leadIn >= paren ? 'lead_in' : 'parenthetical',
    formality: /honorable court|undersigned counsel|respectfully/i.test(text) ? 'formal' : 'plain',
  };
}

function analyzeReasoning(text: string): Record<string, string | boolean> {
  const lower = text.toLowerCase();
  const firstProc = lower.search(PROC);
  const firstLaw = lower.search(/\b(article|section|rule|g\.r\. no|civil code|labor code)\b/);
  const firstEvid = lower.search(/\b(annex|exhibit|evidence|affidavit|record shows|records show)\b/);
  const counter = (text.match(/\b(may argue|might argue|contrary|assuming arguendo|even if|opposing party|respondent's contention|petitioner's contention)\b/gi) ?? []).length;
  const risk = (text.match(/\b(risk|exposure|likelihood|uncertain|weakness)\b/gi) ?? []).length;
  const consti = lower.indexOf('constitution');
  return {
    procedural_first: firstProc >= 0 && firstProc < lower.length * 0.35,
    analysis_order: firstEvid >= 0 && (firstLaw < 0 || firstEvid < firstLaw) ? 'facts_then_law' : 'law_then_facts',
    counterarguments: counter >= 2,
    risk_framing: risk >= 2,
    authority_hierarchy: consti >= 0 && (firstLaw < 0 || consti <= firstLaw + 200),
  };
}

function buildTraits(type: DnaType, samples: { id: string; title: string; text: string }[]): Trait[] {
  const per = samples.map((s) => ({ s, f: type === 'writing' ? analyzeWriting(s.text) : analyzeReasoning(s.text) }));
  return Object.entries(TRAIT_SPEC[type]).map(([key, spec]) => {
    const counts = new Map<string, number>();
    for (const { f } of per) counts.set(String(f[key]), (counts.get(String(f[key])) ?? 0) + 1);
    const [topRaw, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const value: string | boolean = topRaw === 'true' ? true : topRaw === 'false' ? false : topRaw;
    const agree = n / per.length;
    // DEV-208 pending: fewer than 3 samples never reports high confidence.
    const confidence = per.length < 2 ? 'low' : per.length < 3 ? (agree === 1 ? 'medium' : 'low') : agree >= 0.75 ? 'high' : agree >= 0.5 ? 'medium' : 'low';
    return {
      key, label: spec.label, value, statement: spec.describe(value), confidence, enabled: true,
      evidence: per.filter(({ f }) => String(f[key]) === topRaw).map(({ s }) => ({ sample_id: s.id, sample_title: s.title, note: `Observed in “${s.title}”` })),
    };
  });
}

// ---- Profiles (FR-031, FR-032) ----

export interface ProfileRow { id: string; type: DnaType; version: number; traits: Trait[]; status: string; approved_at: Date | null; source_note: string | null; created_at: Date }

export async function listProfiles(ctx: Ctx, type: DnaType) {
  await requirePerm(ctx, 'dna');
  return q<ProfileRow>(`select id, type, version, traits, status, approved_at, source_note, created_at from dna_profiles
                         where tenant_id = $1 and lawyer_id = $2 and type = $3 order by version desc`, [ctx.tenantId, ctx.userId, type]);
}

export async function analyzeProfile(ctx: Ctx, type: DnaType) {
  await requirePerm(ctx, 'dna');
  const consent = await consentState(ctx);
  if (!consent[type]) throw new DomainError('consent_required', 'Consent is required before analysis.');
  const samples = await q<{ id: string; title: string; text: string }>(
    `select id, title, text from dna_samples where tenant_id = $1 and lawyer_id = $2 and status = 'active' and $3 = any(purposes)`, [ctx.tenantId, ctx.userId, type]);
  if (!samples.length) throw new DomainError('invalid_input', 'Add at least one authorized sample for this analysis.');
  const traits = buildTraits(type, samples);
  return tx(async (t) => {
    await q(`update dna_profiles set status = 'superseded' where lawyer_id = $1 and type = $2 and status = 'draft'`, [ctx.userId, type], t);
    const v = (await one<{ v: number }>(`select coalesce(max(version),0)+1 as v from dna_profiles where lawyer_id = $1 and type = $2`, [ctx.userId, type], t))!.v;
    await q(`insert into dna_profiles(tenant_id, lawyer_id, type, version, traits, status, source_note) values ($1,$2,$3,$4,$5,'draft',$6)`,
      [ctx.tenantId, ctx.userId, type, v, JSON.stringify(traits), `Analyzed from ${samples.length} sample(s)`], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'dna.analyze', meta: { type, version: v, samples: samples.length } }, t);
    return v;
  });
}

export async function editDraftTraits(ctx: Ctx, type: DnaType, version: number, edits: Record<string, { value?: string; enabled?: boolean; statement?: string }>) {
  await requirePerm(ctx, 'dna');
  const p = await one<ProfileRow>(`select * from dna_profiles where lawyer_id = $1 and tenant_id = $2 and type = $3 and version = $4`, [ctx.userId, ctx.tenantId, type, version]);
  if (!p) throw new DomainError('not_found_or_denied', 'Profile version not found.');
  if (p.status !== 'draft') throw new DomainError('conflict', 'Only a draft profile version can be edited. Start a new analysis or use feedback proposals.');
  const traits = p.traits.map((tr) => {
    const e = edits[tr.key];
    if (!e) return tr;
    const spec = TRAIT_SPEC[type][tr.key];
    let value: string | boolean = tr.value;
    if (e.value !== undefined) {
      const parsed = e.value === 'true' ? true : e.value === 'false' ? false : e.value;
      if (!spec.values.includes(parsed)) throw new DomainError('invalid_input', `Invalid value for ${spec.label}.`);
      value = parsed;
    }
    const changed = value !== tr.value;
    return { ...tr, value, enabled: e.enabled ?? tr.enabled,
      statement: e.statement?.trim() ? e.statement.trim().slice(0, 300) : changed ? spec.describe(value) : tr.statement,
      confidence: changed ? 'high' as const : tr.confidence,
      evidence: changed ? [{ sample_id: '', sample_title: 'Lawyer edit', note: 'Set directly by the lawyer' }] : tr.evidence };
  });
  await q(`update dna_profiles set traits = $2 where id = $1`, [p.id, JSON.stringify(traits)]);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'dna.profile_edit', meta: { type, version } });
}

export async function approveProfile(ctx: Ctx, type: DnaType, version: number) {
  await requirePerm(ctx, 'dna');
  const consent = await consentState(ctx);
  if (!consent[type]) throw new DomainError('consent_required', 'Consent is required to activate a profile.');
  await tx(async (t) => {
    const p = await one<{ id: string; status: string }>(`select id, status from dna_profiles where lawyer_id = $1 and tenant_id = $2 and type = $3 and version = $4`, [ctx.userId, ctx.tenantId, type, version], t);
    if (!p) throw new DomainError('not_found_or_denied', 'Profile version not found.');
    if (p.status !== 'draft') throw new DomainError('conflict', 'Only a draft version can be approved.');
    await q(`update dna_profiles set status = 'superseded' where lawyer_id = $1 and type = $2 and status in ('active','disabled')`, [ctx.userId, type], t);
    await q(`update dna_profiles set status = 'active', approved_by = $2, approved_at = now() where id = $1`, [p.id, ctx.userId], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'dna.profile_approve', meta: { type, version } }, t);
  });
}

export async function setProfileEnabled(ctx: Ctx, type: DnaType, enabled: boolean) {
  await requirePerm(ctx, 'dna');
  if (enabled && !(await consentState(ctx))[type]) throw new DomainError('consent_required', 'Consent is required to enable a profile.');
  const r = await one(`update dna_profiles set status = $4 where lawyer_id = $1 and tenant_id = $2 and type = $3 and status = $5 returning 1`,
    [ctx.userId, ctx.tenantId, type, enabled ? 'active' : 'disabled', enabled ? 'disabled' : 'active']);
  if (!r) throw new DomainError('invalid_input', enabled ? 'No disabled profile to enable.' : 'No active profile to disable.');
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: enabled ? 'dna.profile_enable' : 'dna.profile_disable', meta: { type } });
}

/** DNA profile tool (FD 06 §5): returns neutral if disabled/withdrawn. Always scoped to the requesting lawyer. */
export async function applicableProfiles(ctx: Ctx, mode: DnaMode) {
  const want = { writing: mode === 'writing' || mode === 'combined', reasoning: mode === 'reasoning' || mode === 'combined' };
  const notes: string[] = [];
  const out: { writing?: { version: number; traits: Trait[] }; reasoning?: { version: number; traits: Trait[] } } = {};
  if (mode === 'neutral' || !ctx.roles.includes('lawyer')) {
    if (mode !== 'neutral') notes.push('Lawyer DNA is available only to lawyers; Neutral mode used.');
    return { ...out, notes, effective: 'neutral' as DnaMode };
  }
  const consent = await consentState(ctx);
  for (const type of ['writing', 'reasoning'] as const) {
    if (!want[type]) continue;
    const label = type === 'writing' ? 'Writing DNA' : 'Reasoning DNA';
    if (!consent[type]) { notes.push(`${label} not applied: consent not active. Neutral used for this dimension.`); continue; }
    const p = await one<{ version: number; traits: Trait[] }>(
      `select version, traits from dna_profiles where tenant_id = $1 and lawyer_id = $2 and type = $3 and status = 'active'`, [ctx.tenantId, ctx.userId, type]);
    if (!p) { notes.push(`${label} not applied: no active approved profile. Neutral used for this dimension.`); continue; }
    out[type] = { version: p.version, traits: p.traits.filter((t) => t.enabled) };
  }
  const effective: DnaMode = out.writing && out.reasoning ? 'combined' : out.writing ? 'writing' : out.reasoning ? 'reasoning' : 'neutral';
  return { ...out, notes, effective };
}

export function traitValue(traits: Trait[] | undefined, key: string): string | boolean | undefined {
  return traits?.find((t) => t.key === key)?.value;
}

// ---- Feedback (FR-035) ----

export interface ProposalChange { key: string; label: string; from: string | boolean; to: string | boolean; reason: string }

export async function listFeedback(ctx: Ctx) {
  await requirePerm(ctx, 'dna');
  return q<{ id: string; draft_id: string; draft_title: string; type: DnaType; base_profile_version: number; proposal: { changes: ProposalChange[] };
    status: string; resulting_profile_version: number | null; created_at: Date; decided_at: Date | null }>(
    `select f.id, f.draft_id, d.title as draft_title, f.type, f.base_profile_version, f.proposal, f.status, f.resulting_profile_version, f.created_at, f.decided_at
       from dna_feedback f join drafts d on d.id = f.draft_id where f.tenant_id = $1 and f.lawyer_id = $2 order by f.created_at desc`, [ctx.tenantId, ctx.userId]);
}

export async function createFeedbackProposal(ctx: Ctx, draftId: string, type: DnaType, changes: ProposalChange[]) {
  const active = await one<{ version: number }>(`select version from dna_profiles where tenant_id = $1 and lawyer_id = $2 and type = $3 and status = 'active'`, [ctx.tenantId, ctx.userId, type]);
  if (!active || !changes.length) return null;
  const r = (await one<{ id: string }>(
    `insert into dna_feedback(tenant_id, lawyer_id, draft_id, type, base_profile_version, proposal) values ($1,$2,$3,$4,$5,$6) returning id`,
    [ctx.tenantId, ctx.userId, draftId, type, active.version, JSON.stringify({ changes })]))!;
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'dna.feedback_propose', meta: { type, changes: changes.length } });
  return r.id;
}

/** Accept → new active version; Reject → no change; Undo (of accepted) → new version restoring prior values. */
export async function decideFeedback(ctx: Ctx, feedbackId: string, decision: 'accept' | 'reject' | 'undo') {
  await requirePerm(ctx, 'dna');
  const consent = await consentState(ctx); // read before opening the transaction (single-connection DB)
  return tx(async (t) => {
    const f = await one<{ id: string; type: DnaType; status: string; proposal: { changes: ProposalChange[] }; resulting_profile_version: number | null }>(
      `select id, type, status, proposal, resulting_profile_version from dna_feedback where id = $1 and tenant_id = $2 and lawyer_id = $3`, [feedbackId, ctx.tenantId, ctx.userId], t);
    if (!f) throw new DomainError('not_found_or_denied', 'Feedback proposal not found.');
    if (decision === 'reject') {
      if (f.status !== 'proposed') throw new DomainError('conflict', 'Only a pending proposal can be rejected.');
      await q(`update dna_feedback set status = 'rejected', decided_at = now() where id = $1`, [f.id], t);
      await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'dna.feedback_reject', targetId: f.id }, t);
      return null;
    }
    if (decision === 'accept' && f.status !== 'proposed') throw new DomainError('conflict', 'Only a pending proposal can be accepted.');
    if (decision === 'undo' && f.status !== 'accepted') throw new DomainError('conflict', 'Only an accepted proposal can be undone.');
    if (!consent[f.type]) throw new DomainError('consent_required', 'Consent is no longer active for this profile type.');
    const active = await one<{ id: string; version: number; traits: Trait[] }>(
      `select id, version, traits from dna_profiles where lawyer_id = $1 and type = $2 and status = 'active'`, [ctx.userId, f.type], t);
    if (!active) throw new DomainError('conflict', 'No active profile to update.');
    const spec = TRAIT_SPEC[f.type];
    const traits = active.traits.map((tr) => {
      const ch = f.proposal.changes.find((c) => c.key === tr.key);
      if (!ch) return tr;
      const value = decision === 'accept' ? ch.to : ch.from;
      return { ...tr, value, statement: spec[tr.key].describe(value), confidence: 'high' as const,
        evidence: [{ sample_id: '', sample_title: 'Approved feedback', note: decision === 'accept' ? ch.reason : 'Restored by undo' }] };
    });
    const v = active.version + 1;
    await q(`update dna_profiles set status = 'superseded' where id = $1`, [active.id], t);
    await q(`insert into dna_profiles(tenant_id, lawyer_id, type, version, traits, status, approved_by, approved_at, source_note)
             values ($1,$2,$3,$4,$5,'active',$2, now(), $6)`,
      [ctx.tenantId, ctx.userId, f.type, v, JSON.stringify(traits), `${decision === 'accept' ? 'Accepted' : 'Undid'} feedback ${f.id.slice(0, 8)}`], t);
    await q(`update dna_feedback set status = $2, resulting_profile_version = $3, decided_at = now() where id = $1`, [f.id, decision === 'accept' ? 'accepted' : 'undone', v], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: `dna.feedback_${decision}`, targetId: f.id, meta: { type: f.type, new_version: v } }, t);
    return v;
  });
}

/** Generic neutral-vs-personalized preview text — built from a fixed fictional paragraph, never from samples. */
export function previewParagraph(traits: Trait[] | undefined) {
  const formal = traitValue(traits, 'formality') === 'formal';
  const lead = traitValue(traits, 'citation_style') === 'lead_in';
  const heading = traitValue(traits, 'heading_style');
  const h = heading === 'upper_roman' ? 'I. STATEMENT OF THE CASE' : heading === 'upper_plain' ? 'STATEMENT OF THE CASE' : '1. Statement of the Case';
  const body = lead
    ? `Under Article 0 of the Fictional Code, ${formal ? 'the undersigned counsel respectfully submits that' : ''} the obligation arose upon delivery.`
    : `${formal ? 'The undersigned counsel respectfully submits that the' : 'The'} obligation arose upon delivery (Art. 0, Fictional Code).`;
  return { heading: h, body: body.replace(/\s+/g, ' ').trim() };
}
