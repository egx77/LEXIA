import { randomUUID } from 'node:crypto';
import { AiRun, aiStatus, StepStop } from './ai/gateway';
import { audit } from './audit';
import { assertMatterAccess, can, requirePerm, type Ctx, type MatterRow } from './authz';
import { sha256, stableStringify } from './crypto';
import { one, q, tx } from './db';
import { analyzeWriting, applicableProfiles, createFeedbackProposal, TRAIT_SPEC, traitValue, type DnaMode, type ProposalChange, type Trait } from './dna';
import { DomainError } from './errors';
import { FACT_LABEL, listFacts, type FactRow } from './matters';
import { checkClaims, composeClaims, getResearch, type Citation, type Claim, type ClaimStatus } from './research';
import { searchPassages } from './sources';

/**
 * Drafting — FR-011 research-to-memo, FR-013 pleading drafting, FR-033 DNA modes, FR-014 QA, approvals.
 * No automatic filing, serving or sending exists anywhere in this module.
 */

export const DOC_TYPES = {
  memorandum: 'Legal Memorandum',
  complaint: 'Complaint',
  answer: 'Answer',
  position_paper: 'Position Paper',
  demand_letter: 'Demand Letter',
} as const;
export type DocType = keyof typeof DOC_TYPES;

export interface Block {
  id: string;
  kind: 'title' | 'caption' | 'heading' | 'para' | 'note';
  text: string;
  section?: 'facts' | 'issues' | 'discussion' | 'counter' | 'risk' | 'prayer' | 'signature' | 'opening' | 'verification' | 'limitations';
  procedural?: boolean;
  claim?: { issue: string; citations: Citation[]; status: ClaimStatus; reasons: string[] };
  fact?: { id: string; classification: string };
}

export interface DraftContent {
  blocks: Block[];
  personalization: { requested: DnaMode; effective: DnaMode; writing_version?: number; reasoning_version?: number; notes: string[] };
  limitations: string[];
}

const PROC_RE = /\b(jurisdiction|prescription|prescribed|venue|cause of action|exhaustion|forum shopping|litis pendentia|res judicata|standing|premature|timel(y|iness))\b/i;
const QUALIFY_RE = /\b(unless|except|provided, however|however|shall not)\b/i;
const HIERARCHY: Record<string, number> = { constitution: 0, statute: 1, rule: 2, decision: 3, issuance: 4, reference: 5 };

// ---- Pure assembly (deterministic; used for both personalized and neutral comparison) ----

interface IssueClaims { issue: string; claims: Claim[]; procedural: boolean }
interface AssemblyInput {
  docType: DocType; matter?: Pick<MatterRow, 'title' | 'client_name' | 'opposing_party' | 'practice_area'> | null;
  question?: string; facts: FactRow[]; issues: IssueClaims[]; writing?: Trait[]; reasoning?: Trait[];
  sourceTypeOf?: Map<string, string>;
}

function b(kind: Block['kind'], text: string, extra: Partial<Block> = {}): Block {
  return { id: randomUUID(), kind, text, ...extra };
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function assemble(input: AssemblyInput): { blocks: Block[]; notes: string[] } {
  const w = input.writing;
  const r = input.reasoning;
  const notes: string[] = [];
  const headingStyle = (traitValue(w, 'heading_style') as string) ?? 'title_arabic';
  const formal = traitValue(w, 'formality') === 'formal';
  const leadIn = traitValue(w, 'citation_style') === 'lead_in';
  const expansive = traitValue(w, 'sentence_length') === 'expansive';
  const concise = traitValue(w, 'sentence_length') === 'concise';
  const comesNow = traitValue(w, 'opening') === 'comes_now';
  const wherefore = traitValue(w, 'prayer') === 'wherefore_premises';
  const proceduralFirst = traitValue(r, 'procedural_first');
  const factsFirst = traitValue(r, 'analysis_order') === 'facts_then_law';
  const counter = traitValue(r, 'counterarguments') === true;
  const risk = traitValue(r, 'risk_framing') === true;
  const hierarchy = traitValue(r, 'authority_hierarchy') === true;

  if (w) notes.push(`Writing DNA applied: ${w.map((t) => t.statement).join('; ')}.`);
  if (r) notes.push(`Reasoning DNA applied: ${r.map((t) => t.statement).join('; ')}.`);

  let hn = 0;
  const H = (title: string, extra: Partial<Block> = {}) => {
    const i = hn++;
    const txt = headingStyle === 'upper_roman' ? `${ROMAN[i] ?? i + 1}. ${title.toUpperCase()}`
      : headingStyle === 'upper_plain' ? title.toUpperCase() : `${i + 1}. ${title}`;
    return b('heading', txt, extra);
  };
  const court = formal ? 'this Honorable Court' : 'the Court';
  const counsel = formal ? 'the undersigned counsel' : 'counsel';
  const client = input.matter?.client_name ?? 'Client';
  const opp = input.matter?.opposing_party || '[Opposing party]';
  const blocks: Block[] = [];
  const isLetter = input.docType === 'demand_letter';
  const isMemo = input.docType === 'memorandum';

  // Caption / title
  if (!isMemo && !isLetter) {
    blocks.push(b('caption', `REPUBLIC OF THE PHILIPPINES\n[Court / tribunal and branch — to be completed by the lawyer]\n\n${input.docType === 'answer' ? opp : client},\n    ${input.docType === 'answer' ? 'Plaintiff' : input.docType === 'position_paper' ? 'Complainant' : 'Plaintiff'},\n  — versus —\n${input.docType === 'answer' ? client : opp},\n    ${input.docType === 'answer' ? 'Defendant' : 'Respondent/Defendant'}.\n\n[Case No. — to be completed]`));
  }
  blocks.push(b('title', isMemo ? 'MEMORANDUM' : DOC_TYPES[input.docType].toUpperCase()));
  if (isMemo) {
    blocks.push(b('para', `TO: [Recipient]\nFROM: [Lawyer]\nDATE: ${new Date().toISOString().slice(0, 10)}\nRE: ${input.matter?.title ?? 'Legal research'}`));
  }
  if (isLetter) {
    blocks.push(b('para', `[Date]\n\n${opp}\n[Address]\n\nDear ${opp}:`, { section: 'opening' }));
  } else if (!isMemo) {
    const party = input.docType === 'answer' ? 'Defendant' : input.docType === 'position_paper' ? 'Complainant' : 'Plaintiff';
    blocks.push(b('para', comesNow
      ? `COMES NOW ${party} ${client}, through ${counsel}, and unto ${court} most respectfully states:`
      : `${party} ${client}, through ${counsel}, states:`, { section: 'opening' }));
  }
  if (isMemo && input.question) {
    blocks.push(H('Question presented'));
    blocks.push(b('para', input.question));
  }

  // Facts (labels preserved: allegation / evidence / finding / unverified)
  const factBlocks = () => {
    const out: Block[] = [H(isMemo ? 'Facts supplied' : 'Statement of facts', { section: 'facts' })];
    if (!input.facts.length) out.push(b('note', '[No matter facts recorded. Add facts with their classification in the matter workspace.]', { section: 'facts' }));
    for (const f of input.facts) {
      const when = f.occurred_on ? `On ${f.occurred_on}, ` : '';
      const src = f.source_title ? ` (${f.source_title}${f.source_locator ? `, ${f.source_locator}` : ''})` : '';
      const lead = f.classification === 'allegation' ? 'It is alleged that ' : f.classification === 'unverified' ? '[UNVERIFIED — confirm before relying on this] ' : '';
      const body = `${when}${lead}${lead ? f.statement.replace(/^\w/, (c) => c.toLowerCase()) : f.statement}`;
      out.push(b('para', `${body}${src} [${FACT_LABEL[f.classification]}]`, { section: 'facts', fact: { id: f.id, classification: f.classification } }));
    }
    return out;
  };

  // Issues ordering
  let issues = [...input.issues];
  const hasProcedural = issues.some((i) => i.procedural);
  if (proceduralFirst === true) issues.sort((a, z) => Number(z.procedural) - Number(a.procedural));
  if (proceduralFirst === false && hasProcedural) {
    issues.sort((a, z) => Number(a.procedural) - Number(z.procedural));
    notes.push('Conflict noted: Reasoning DNA prefers merits first, but procedural threshold issues are still included in full — mandatory procedure is never omitted.');
  }

  const claimText = (c: Claim, sentencePrefix: string) => {
    const cit = c.citations[0];
    if (!cit) return c.text;
    const core = leadIn ? `Under ${cit.locator} of ${cit.source_title}: “${cit.quote}”` : `“${cit.quote}” (${cit.source_title}, ${cit.locator})`;
    return `${sentencePrefix}${core}`;
  };
  const prefix = expansive ? (formal ? 'It is respectfully submitted that the governing provision applies. ' : 'The governing provision applies. ') : '';

  const discussionBlocks = () => {
    const out: Block[] = [H(isMemo ? 'Discussion' : isLetter ? 'Basis of demand' : 'Discussion and arguments', { section: 'discussion' })];
    issues.forEach((iss, idx) => {
      out.push(b('heading', `${isMemo ? 'Issue' : 'Argument'} ${idx + 1}: ${iss.issue}${iss.procedural ? ' [procedural threshold]' : ''}`, { section: 'discussion', procedural: iss.procedural }));
      let claims = [...iss.claims];
      if (hierarchy && input.sourceTypeOf) {
        claims.sort((a, z) => (HIERARCHY[input.sourceTypeOf!.get(a.citations[0]?.source_id ?? '') ?? 'reference'] ?? 9) - (HIERARCHY[input.sourceTypeOf!.get(z.citations[0]?.source_id ?? '') ?? 'reference'] ?? 9));
      }
      const relevantFacts = input.facts.filter((f) => f.classification !== 'unverified').slice(0, 2);
      const factLine = relevantFacts.length
        ? b('para', `Applying the law to the recorded facts: ${relevantFacts.map((f) => `${f.statement} [${FACT_LABEL[f.classification]}]`).join(' ')} [Lawyer to complete the application.]`, { section: 'discussion' })
        : null;
      if (factsFirst && factLine) out.push(factLine);
      for (const c of claims) {
        out.push(b('para', claimText(c, concise ? '' : prefix), { section: 'discussion', claim: { issue: c.issue, citations: c.citations, status: c.status, reasons: c.reasons } }));
      }
      if (!factsFirst && factLine) out.push(factLine);
    });
    return out;
  };

  if (isMemo || factsFirst) { blocks.push(...factBlocks()); }
  if (!isMemo && !isLetter) {
    blocks.push(H('Issues', { section: 'issues' }));
    issues.forEach((i, n) => blocks.push(b('para', `${n + 1}. ${i.issue}`, { section: 'issues', procedural: i.procedural })));
  }
  if (!(isMemo || factsFirst)) blocks.push(...factBlocks());
  blocks.push(...discussionBlocks());

  if (counter) {
    blocks.push(H('Anticipated counterarguments', { section: 'counter' }));
    const qualifying = issues.flatMap((i) => i.claims).filter((c) => c.citations[0] && QUALIFY_RE.test(c.citations[0].quote));
    if (!qualifying.length) blocks.push(b('note', 'The opposing party may argue otherwise; no adverse or qualifying provision was found in the permitted sources. [Lawyer to assess adverse authority.]', { section: 'counter' }));
    for (const c of qualifying) {
      blocks.push(b('para', `The opposing party may argue that a qualification applies: ${claimText(c, '')}`, { section: 'counter', claim: { issue: c.issue, citations: c.citations, status: c.status, reasons: c.reasons } }));
    }
  }
  if (risk) {
    blocks.push(H('Risks and gaps', { section: 'risk' }));
    const unverifiedFacts = input.facts.filter((f) => f.classification === 'unverified' || f.classification === 'allegation').length;
    const weak = issues.flatMap((i) => i.claims).filter((c) => c.status !== 'verified').length;
    blocks.push(b('para', `Open risks identified from the record: ${unverifiedFacts} fact(s) are allegations or unverified; ${weak} legal proposition(s) need checking or lack an authorized source. No outcome prediction is made.`, { section: 'risk' }));
  }

  // Prayer / closing
  if (isMemo) {
    blocks.push(H('Conclusion', { section: 'prayer' }));
    blocks.push(b('note', '[Lawyer to state the conclusion and advice. LEXIA does not give final legal advice.]', { section: 'prayer' }));
  } else if (isLetter) {
    blocks.push(b('para', `${formal ? 'We respectfully demand' : 'We demand'} [lawyer to state the specific demand and period for compliance].`, { section: 'prayer' }));
  } else if (wherefore) {
    blocks.push(b('para', `WHEREFORE, premises considered, it is respectfully prayed that ${court} [lawyer to state the specific relief sought]. Other reliefs just and equitable under the premises are likewise prayed for.`, { section: 'prayer' }));
  } else {
    blocks.push(H('Relief sought', { section: 'prayer' }));
    blocks.push(b('para', '[Lawyer to state the specific relief sought. LEXIA does not determine remedies.]', { section: 'prayer' }));
  }
  blocks.push(b('note', '[Counsel name, address, Roll of Attorneys No., IBP No., PTR No., MCLE Compliance No. — to be completed by the lawyer]', { section: 'signature' }));
  if (!isMemo && !isLetter) {
    blocks.push(b('note', '[Verification, certification against forum shopping and other attachments, if required — to be prepared and reviewed by the lawyer]', { section: 'verification' }));
  }
  blocks.push(b('note', 'Draft prepared with LEXIA. Not filed, served or sent. Requires lawyer review and approval.', { section: 'limitations' }));
  return { blocks, notes };
}

// ---- Content checks ----

export function needsChecking(content: DraftContent) {
  const items: { blockId: string; label: string; reasons: string[] }[] = [];
  for (const blk of content.blocks) {
    if (blk.claim && blk.claim.status !== 'verified') items.push({ blockId: blk.id, label: blk.claim.status === 'unverified' ? 'Unsupported proposition' : 'Citation needs checking', reasons: blk.claim.reasons });
    if (blk.fact && blk.fact.classification === 'unverified') items.push({ blockId: blk.id, label: 'Unverified fact', reasons: ['Confirm before relying on this fact.'] });
    if (/\[(lawyer to|court \/|case no\.|counsel name|recipient|lawyer\])/i.test(blk.text)) items.push({ blockId: blk.id, label: 'Placeholder to complete', reasons: ['Bracketed placeholder text remains.'] });
  }
  return items;
}

async function recheck(ctx: Ctx, content: DraftContent): Promise<DraftContent> {
  const claimBlocks = content.blocks.filter((x) => x.claim);
  const claims: Claim[] = claimBlocks.map((x) => ({ id: x.id, issue: x.claim!.issue, text: x.text, citations: x.claim!.citations, status: x.claim!.status, reasons: [] }));
  const checked = await checkClaims(ctx, claims, { blockText: new Map(claimBlocks.map((x) => [x.id, x.text])) });
  const byId = new Map(checked.map((c) => [c.id, c]));
  return { ...content, blocks: content.blocks.map((x) => x.claim ? { ...x, claim: { ...x.claim, status: byId.get(x.id)!.status, reasons: byId.get(x.id)!.reasons } } : x) };
}

function contentHash(content: DraftContent) { return sha256(stableStringify(content)); }

// ---- Generation ----

export interface GenerateInput { matterId?: string; docType: DocType; dnaMode: DnaMode; title?: string; issuesText?: string; researchQueryId?: string; idempotencyKey?: string }

export interface GenerateOutcome { draftId: string; state: 'complete' | 'partial' | 'manual'; message: string | null }

export async function generateDraft(ctx: Ctx, input: GenerateInput): Promise<GenerateOutcome> {
  await requirePerm(ctx, 'draft');
  if (!(input.docType in DOC_TYPES)) throw new DomainError('invalid_input', 'Unknown document type.');
  if (!['neutral', 'writing', 'reasoning', 'combined'].includes(input.dnaMode)) throw new DomainError('invalid_input', 'Unknown drafting mode.');
  const matter = input.matterId ? await assertMatterAccess(ctx, input.matterId) : null;
  if (!matter && input.docType !== 'memorandum') throw new DomainError('invalid_input', 'Pleadings and letters must be drafted inside an authorized matter.');
  const research = input.researchQueryId ? await getResearch(ctx, input.researchQueryId) : null;
  if (research && research.matter_id && research.matter_id !== (matter?.id ?? null)) throw new DomainError('invalid_input', 'Research belongs to a different matter.');
  const facts = matter ? await listFacts(ctx, matter.id) : [];
  const profiles = await applicableProfiles(ctx, input.dnaMode);

  const issueTexts = research
    ? research.result.issues
    : (input.issuesText ?? matter?.issues ?? '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const issues: IssueClaims[] = [];
  const limitations: string[] = [];
  let state: GenerateOutcome['state'] = 'complete';
  let message: string | null = null;
  let runId: string | null = null;

  if (research) {
    // Research-to-memo: claims were composed during research; assembly is deterministic and needs no AI.
    for (const issue of research.result.issues) {
      const cl = research.result.claims.filter((c) => c.issue === issue);
      issues.push({ issue, claims: cl, procedural: PROC_RE.test(issue) });
    }
    limitations.push(...research.result.limitations);
    if (research.result.ai !== 'ok') { state = 'partial'; message = research.result.ai_message; }
  } else {
    const st = await aiStatus(ctx.tenantId);
    if (!st.available) {
      state = 'manual';
      message = `${st.reason} A manual template was created with your matter facts; AI analysis paused.`;
      for (const issue of issueTexts) issues.push({ issue, claims: [], procedural: PROC_RE.test(issue) });
    } else {
      const run = await AiRun.start(ctx, 'draft', matter?.id, input.idempotencyKey);
      runId = run.id;
      try {
        for (const [i, issue] of issueTexts.entries()) {
          const hits = await searchPassages(ctx, { query: issue, mode: 'hybrid', requireUse: 'ai_processing', matterId: matter?.id, limit: 6 });
          const comp = await run.step(`compose:${i + 1}`, 2, () => composeClaims(issue, hits, { fabricate: run.simulation === 'fabricated_citation' }));
          issues.push({ issue, claims: comp.claims, procedural: PROC_RE.test(issue) });
          limitations.push(...comp.limitations);
        }
        await run.finish('completed');
      } catch (e) {
        if (!(e instanceof StepStop)) { await run.finish('failed', 'internal_error'); throw e; }
        state = 'partial';
        message = e.message;
        for (const issue of issueTexts.slice(issues.length)) issues.push({ issue, claims: [], procedural: PROC_RE.test(issue) });
        await run.finish(issues.some((i) => i.claims.length) ? 'partial' : 'unavailable', e.kind);
      }
    }
    if (!issueTexts.length) limitations.push('No issues were recorded for this matter; add issues to receive cited analysis.');
  }

  // Mark issues without AI output as explicitly pending (never silently empty).
  for (const iss of issues) {
    if (!iss.claims.length) iss.claims.push({ id: randomUUID(), issue: iss.issue, text: '[Analysis pending — AI unavailable or not yet run. Research this issue manually.]', citations: [], status: 'unverified', reasons: ['No analysis generated.'] });
  }

  const srcIds = [...new Set(issues.flatMap((i) => i.claims.flatMap((c) => c.citations.map((x) => x.source_id ?? ''))).filter(Boolean))];
  const typeRows = srcIds.length ? await q<{ id: string; source_type: string }>(`select id, source_type from legal_sources where id = any($1::uuid[])`, [srcIds]) : [];
  const sourceTypeOf = new Map(typeRows.map((r) => [r.id, r.source_type]));

  const base = { docType: input.docType, matter, question: research?.question, facts, issues, sourceTypeOf };
  const personalized = assemble({ ...base, writing: profiles.writing?.traits, reasoning: profiles.reasoning?.traits });
  const neutral = assemble(base);

  let content: DraftContent = {
    blocks: personalized.blocks,
    personalization: { requested: input.dnaMode, effective: profiles.effective, writing_version: profiles.writing?.version, reasoning_version: profiles.reasoning?.version,
      notes: [...profiles.notes, ...personalized.notes] },
    limitations: [...new Set(limitations)],
  };
  content = await recheck(ctx, content);
  const neutralContent = await recheck(ctx, { blocks: neutral.blocks, personalization: { requested: 'neutral', effective: 'neutral', notes: [] }, limitations: content.limitations });

  const title = input.title?.trim() || `${DOC_TYPES[input.docType]} — ${matter?.title ?? research?.question.slice(0, 60) ?? 'Untitled'}`;
  const draftId = await tx(async (t) => {
    const d = (await one<{ id: string }>(
      `insert into drafts(tenant_id, matter_id, title, doc_type, dna_mode, applied_writing_version, applied_reasoning_version, current_version,
         research_query_id, neutral_content, generation_state, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11) returning id`,
      [ctx.tenantId, matter?.id ?? null, title, input.docType, profiles.effective, profiles.writing?.version ?? null, profiles.reasoning?.version ?? null,
        research?.id ?? null, JSON.stringify(neutralContent), state, ctx.userId], t))!;
    await q(`insert into draft_versions(draft_id, version, content, content_hash, author_kind, created_by, ai_run_id, note) values ($1,1,$2,$3,$4,$5,$6,$7)`,
      [d.id, JSON.stringify(content), contentHash(content), state === 'manual' ? 'system' : 'ai', ctx.userId, runId, state === 'complete' ? 'Generated draft' : `Generated (${state})`], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'draft.generate', targetType: matter ? 'matter' : 'draft', targetId: matter?.id ?? d.id,
      meta: { draft_id: d.id, doc_type: input.docType, mode_requested: input.dnaMode, mode_effective: profiles.effective, state } }, t);
    return d.id;
  });
  return { draftId, state, message };
}

// ---- Read ----

export interface DraftRow {
  id: string; tenant_id: string; matter_id: string | null; matter_title: string | null; title: string; doc_type: DocType; dna_mode: DnaMode;
  applied_writing_version: number | null; applied_reasoning_version: number | null; status: string; current_version: number;
  neutral_content: DraftContent | null; generation_state: string; created_by: string; created_at: Date;
}

export async function getDraft(ctx: Ctx, draftId: string, version?: number) {
  await requirePerm(ctx, 'draft');
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) throw new DomainError('not_found_or_denied', 'Draft not found.');
  const d = await one<DraftRow>(`select d.*, m.title as matter_title from drafts d left join matters m on m.id = d.matter_id where d.id = $1 and d.tenant_id = $2`, [draftId, ctx.tenantId]);
  if (!d) throw new DomainError('not_found_or_denied', 'Draft not found.');
  if (d.matter_id) await assertMatterAccess(ctx, d.matter_id);
  else if (d.created_by !== ctx.userId) throw new DomainError('not_found_or_denied', 'Draft not found.');
  const v = await one<{ version: number; content: DraftContent; content_hash: string; author_kind: string; author_name: string; note: string | null; created_at: Date }>(
    `select v.version, v.content, v.content_hash, v.author_kind, u.name as author_name, v.note, v.created_at from draft_versions v join users u on u.id = v.created_by
      where v.draft_id = $1 and v.version = $2`, [draftId, version ?? d.current_version]);
  if (!v) throw new DomainError('not_found_or_denied', 'Version not found.');
  const versions = await q<{ version: number; author_kind: string; author_name: string; note: string | null; created_at: Date }>(
    `select v.version, v.author_kind, u.name as author_name, v.note, v.created_at from draft_versions v join users u on u.id = v.created_by where v.draft_id = $1 order by v.version desc`, [draftId]);
  const approval = await one<{ target_version: number; actor_name: string; created_at: Date; action_hash: string; acknowledged_open_items: number }>(
    `select a.target_version, u.name as actor_name, a.created_at, a.action_hash, a.acknowledged_open_items from approvals a join users u on u.id = a.actor_id
      where a.target_type = 'draft' and a.target_id = $1 and a.invalidated_at is null order by a.created_at desc limit 1`, [draftId]);
  return { draft: d, version: v, versions, approval };
}

export async function listDrafts(ctx: Ctx, matterId?: string) {
  if (!can(ctx, 'draft')) return [];
  if (matterId) await assertMatterAccess(ctx, matterId);
  return q<{ id: string; title: string; doc_type: string; status: string; current_version: number; matter_id: string | null; matter_title: string | null; dna_mode: string; generation_state: string; created_at: Date }>(
    `select d.id, d.title, d.doc_type, d.status, d.current_version, d.matter_id, m.title as matter_title, d.dna_mode, d.generation_state, d.created_at
       from drafts d left join matters m on m.id = d.matter_id
      where d.tenant_id = $1 and ($2::uuid is null or d.matter_id = $2)
        and ((d.matter_id is null and d.created_by = $3) or exists (select 1 from matter_assignments a where a.matter_id = d.matter_id and a.user_id = $3))
      order by d.created_at desc limit 100`, [ctx.tenantId, matterId ?? null, ctx.userId]);
}

// ---- Edit (new immutable version, optimistic concurrency) ----

export interface EditInput { baseVersion: number; texts: Record<string, string>; deleted?: string[]; append?: { kind: 'para' | 'heading'; text: string } | null; note?: string }

export async function saveDraftVersion(ctx: Ctx, draftId: string, input: EditInput) {
  const { draft, version } = await getDraft(ctx, draftId);
  if (input.baseVersion !== draft.current_version) throw new DomainError('conflict', `This draft changed (now version ${draft.current_version}). Reload before saving so you do not overwrite another reviewer.`);
  const del = new Set(input.deleted ?? []);
  let blocks = version.content.blocks.filter((x) => !del.has(x.id)).map((x) => input.texts[x.id] !== undefined && input.texts[x.id] !== x.text ? { ...x, text: input.texts[x.id] } : x);
  if (input.append?.text.trim()) blocks = [...blocks, b(input.append.kind, input.append.text.trim())];
  let content: DraftContent = { ...version.content, blocks };
  content = await recheck(ctx, content);
  const hash = contentHash(content);
  if (hash === version.content_hash) return draft.current_version;
  const next = draft.current_version + 1;
  await tx(async (t) => {
    const upd = await one(`update drafts set current_version = $2, status = 'draft' where id = $1 and current_version = $3 returning 1`, [draftId, next, input.baseVersion], t);
    if (!upd) throw new DomainError('conflict', 'This draft changed while you were editing. Reload before saving.');
    await q(`insert into draft_versions(draft_id, version, content, content_hash, author_kind, created_by, note) values ($1,$2,$3,$4,$5,$6,$7)`,
      [draftId, next, JSON.stringify(content), hash, ctx.roles.includes('lawyer') ? 'lawyer' : 'assistant', ctx.userId, input.note?.trim() || 'Edited'], t);
    const inv = await q(`update approvals set invalidated_at = now() where target_type = 'draft' and target_id = $1 and invalidated_at is null returning id`, [draftId], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'draft.edit', targetType: 'draft', targetId: draftId, meta: { version: next, approvals_invalidated: inv.length } }, t);
  });
  return next;
}

export async function submitForReview(ctx: Ctx, draftId: string) {
  const { draft } = await getDraft(ctx, draftId);
  if (draft.status !== 'draft') throw new DomainError('conflict', 'Only a draft can be submitted for review.');
  await q(`update drafts set status = 'in_review' where id = $1`, [draftId]);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'draft.submit_review', targetType: 'draft', targetId: draftId });
}

/**
 * Lawyer approval of an exact version (FD 05 §3 review contract). The approval hash binds draft, version and content;
 * any later edit invalidates it. Open "needs checking" items require explicit acknowledgement.
 */
export async function approveDraft(ctx: Ctx, draftId: string, input: { version: number; acknowledgeOpenItems: boolean }) {
  await requirePerm(ctx, 'approve_legal');
  const { draft, version } = await getDraft(ctx, draftId);
  if (input.version !== draft.current_version) throw new DomainError('approval_invalid', 'You can only approve the current version. Review the latest version first.');
  const open = needsChecking(version.content);
  if (open.length && !input.acknowledgeOpenItems) throw new DomainError('approval_invalid', `${open.length} item(s) still need checking. Review them and acknowledge before approving.`);
  const actionHash = sha256(`draft:${draftId}:v${version.version}:${version.content_hash}:approve`);
  await tx(async (t) => {
    await q(`insert into approvals(tenant_id, target_type, target_id, target_version, action, action_hash, acknowledged_open_items, actor_id)
             values ($1,'draft',$2,$3,'approve',$4,$5,$6)`, [ctx.tenantId, draftId, version.version, actionHash, open.length, ctx.userId], t);
    await q(`update drafts set status = 'approved' where id = $1`, [draftId], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'draft.approve', targetType: 'draft', targetId: draftId,
      meta: { version: version.version, action_hash: actionHash, open_items_acknowledged: open.length } }, t);
  });
  return actionHash;
}

// ---- Diff (what changed between versions) ----

export function diffContents(a: DraftContent, z: DraftContent) {
  const am = new Map(a.blocks.map((x) => [x.id, x]));
  const zm = new Map(z.blocks.map((x) => [x.id, x]));
  const out: { type: 'added' | 'removed' | 'changed'; before?: string; after?: string }[] = [];
  for (const x of a.blocks) if (!zm.has(x.id)) out.push({ type: 'removed', before: x.text });
  for (const x of z.blocks) {
    const prev = am.get(x.id);
    if (!prev) out.push({ type: 'added', after: x.text });
    else if (prev.text !== x.text) out.push({ type: 'changed', before: prev.text, after: x.text });
  }
  return out;
}

// ---- DNA feedback proposals from lawyer edits (FR-035) ----

export async function proposeDnaFeedback(ctx: Ctx, draftId: string) {
  await requirePerm(ctx, 'dna');
  const { draft } = await getDraft(ctx, draftId);
  const first = await one<{ content: DraftContent }>(`select content from draft_versions where draft_id = $1 and author_kind = 'ai' order by version limit 1`, [draftId]);
  const latest = await one<{ content: DraftContent; author_kind: string }>(`select content, author_kind from draft_versions where draft_id = $1 order by version desc limit 1`, [draftId]);
  if (!first || !latest || latest.author_kind !== 'lawyer') throw new DomainError('invalid_input', 'Edit and save the AI draft first; proposals compare the AI version with your edits.');
  const created: string[] = [];
  const textOf = (c: DraftContent) => c.blocks.map((x) => x.text).join('\n');

  // Writing: features where the lawyer's edit moved away from what the AI version showed.
  const wa = analyzeWriting(textOf(first.content));
  const wl = analyzeWriting(textOf(latest.content));
  const wActive = await one<{ traits: Trait[] }>(`select traits from dna_profiles where lawyer_id = $1 and tenant_id = $2 and type = 'writing' and status = 'active'`, [ctx.userId, ctx.tenantId]);
  if (wActive) {
    const changes: ProposalChange[] = [];
    for (const key of Object.keys(TRAIT_SPEC.writing)) {
      const cur = traitValue(wActive.traits, key);
      if (wa[key] !== wl[key] && cur !== undefined && String(cur) !== wl[key]) {
        changes.push({ key, label: TRAIT_SPEC.writing[key].label, from: cur, to: wl[key], reason: `In draft “${draft.title}” you changed this to: ${TRAIT_SPEC.writing[key].describe(wl[key])}.` });
      }
    }
    const id = await createFeedbackProposal(ctx, draftId, 'writing', changes);
    if (id) created.push(id);
  }

  // Reasoning: section-level edits.
  const rActive = await one<{ traits: Trait[] }>(`select traits from dna_profiles where lawyer_id = $1 and tenant_id = $2 and type = 'reasoning' and status = 'active'`, [ctx.userId, ctx.tenantId]);
  if (rActive) {
    const has = (c: DraftContent, s: Block['section']) => c.blocks.some((x) => x.section === s && x.kind === 'heading');
    const changes: ProposalChange[] = [];
    for (const [key, section] of [['counterarguments', 'counter'], ['risk_framing', 'risk']] as const) {
      const before = has(first.content, section);
      const after = has(latest.content, section) || (section === 'counter' && /\bmay argue\b/i.test(textOf(latest.content)) && !before);
      const cur = traitValue(rActive.traits, key);
      if (before !== after && cur !== after) changes.push({ key, label: TRAIT_SPEC.reasoning[key].label, from: cur ?? !after, to: after, reason: `You ${after ? 'added' : 'removed'} the ${section === 'counter' ? 'counterargument' : 'risk'} section in “${draft.title}”.` });
    }
    const id = await createFeedbackProposal(ctx, draftId, 'reasoning', changes);
    if (id) created.push(id);
  }
  return created.length;
}
