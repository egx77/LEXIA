import { randomUUID } from 'node:crypto';
import { AiRun, aiStatus, looksLikeInstruction, requestExternalAction, StepStop } from './ai/gateway';
import { audit } from './audit';
import { assertMatterAccess, requirePerm, type Ctx } from './authz';
import { one, q } from './db';
import { overlap } from './embedding';
import { DomainError } from './errors';
import { resolvePassages, searchPassages, type PassageHit, type Scope } from './sources';

/**
 * Legal Truth Engine — FR-010 verified research, FR-014 citation QA.
 * Claim status vocabulary (FD 03 §2):
 *   verified       — "Verified source": exact quote resolves to an authorized, in-scope, current-version passage that
 *                    is relevant to the issue. Not a statement that the authority remains good law.
 *   needs_checking — some support exists but a check failed (stale/superseded source, weak relevance, quote mismatch).
 *   unverified     — no authorized source found. LEXIA never fabricates a citation.
 */

export type ClaimStatus = 'verified' | 'needs_checking' | 'unverified';

export interface Citation {
  passage_id: string; quote: string; locator: string; source_title: string; source_id?: string; version_label?: string; checked_at?: string;
}

export interface Claim {
  id: string; issue: string; text: string; citations: Citation[]; status: ClaimStatus; reasons: string[];
}

export interface ResearchResult {
  question: string;
  mode: 'hybrid' | 'keyword';
  ai: 'ok' | 'unavailable' | 'quota_exhausted' | 'partial' | 'timeout';
  ai_message: string | null;
  issues: string[];
  supplied_facts: string[];
  claims: Claim[];
  hits: Pick<PassageHit, 'passage_id' | 'locator' | 'text' | 'source_id' | 'source_title' | 'authority' | 'version_label' | 'checked_at' | 'warnings' | 'scope' | 'score'>[];
  limitations: string[];
  run_id: string | null;
}

// ---- Parsing (deterministic, no AI) ----

export function parseQuestion(question: string): { issues: string[]; facts: string[] } {
  const sentences = question.replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
  const issues: string[] = [];
  const facts: string[] = [];
  for (const s of sentences) {
    if (s.endsWith('?') || /^(whether|what|when|how|can|may|is|are|does|do|should)\b/i.test(s)) {
      for (const part of s.split(/;\s*|\s+and whether\s+/i)) if (part.trim().length > 8) issues.push(part.trim().replace(/^\w/, (c) => c.toUpperCase()));
    } else facts.push(s);
  }
  if (!issues.length && question.trim()) issues.push(question.trim());
  return { issues: issues.slice(0, 6), facts };
}

function bestSentence(passage: string, issue: string): string {
  const sents = passage.split(/(?<=[.;:])\s+(?=[A-Z(“"])/).map((s) => s.trim()).filter((s) => s.length > 25);
  if (!sents.length) return passage.trim();
  let best = sents[0];
  let bestScore = -1;
  for (const s of sents) {
    const sc = overlap(issue, s);
    if (sc > bestScore) { best = s; bestScore = sc; }
  }
  return best;
}

// ---- Composer (the "AI" step of the local extractive adapter) ----

export function composeClaims(issue: string, hits: PassageHit[], opts: { fabricate?: boolean } = {}): { claims: Claim[]; limitations: string[] } {
  const limitations: string[] = [];
  const usable = hits.filter((h) => {
    if (looksLikeInstruction(h.text)) {
      limitations.push(`A retrieved passage (${h.source_title}, ${h.locator}) contained instruction-like text; it was treated as data and not used.`);
      return false;
    }
    return true;
  });
  const ranked = usable.map((h) => ({ h, rel: overlap(issue, h.text) })).filter((x) => x.rel > 0).sort((a, b) => b.rel - a.rel).slice(0, 3);
  const claims: Claim[] = ranked.map(({ h }) => {
    const quote = bestSentence(h.text, issue);
    return {
      id: randomUUID(), issue,
      text: `${h.source_title}, ${h.locator}, provides: “${quote}”`,
      citations: [{ passage_id: h.passage_id, quote, locator: h.locator, source_title: h.source_title, source_id: h.source_id,
        version_label: h.version_label, checked_at: new Date(h.checked_at).toISOString() }],
      status: 'needs_checking', reasons: ['Not yet checked'],
    };
  });
  if (opts.fabricate) {
    // Fault fixture (FD 07 §6): a fabricated citation the independent checker must catch.
    claims.push({ id: randomUUID(), issue, text: 'Santos v. Imaginary Holdings, G.R. No. 000000 (fictional), holds that the claim is automatically valid.',
      citations: [{ passage_id: randomUUID(), quote: 'the claim is automatically valid', locator: 'p. 1', source_title: 'Santos v. Imaginary Holdings (fictional)' }],
      status: 'needs_checking', reasons: [] });
  }
  if (!claims.length) {
    claims.push({ id: randomUUID(), issue, text: 'No authorized source found for this claim. Unverified; lawyer review required.', citations: [], status: 'unverified',
      reasons: ['No permitted passage matched this issue. Use manual source search; LEXIA does not fabricate citations.'] });
  }
  return { claims, limitations };
}

// ---- Independent checker (FR-014) — fails closed ----

export async function checkClaims(ctx: Ctx, claims: Claim[], opts: { blockText?: Map<string, string> } = {}): Promise<Claim[]> {
  const ids = [...new Set(claims.flatMap((c) => c.citations.map((x) => x.passage_id)))];
  const ai = await resolvePassages(ctx, ids, 'ai_processing');
  const disp = await resolvePassages(ctx, ids, 'display');
  return claims.map((c) => {
    if (!c.citations.length) {
      return { ...c, status: 'unverified' as const, reasons: c.reasons.length ? c.reasons : ['No citation supplied.'] };
    }
    const reasons: string[] = [];
    let resolved = 0;
    for (const cit of c.citations) {
      const p = ai.get(cit.passage_id) ?? disp.get(cit.passage_id);
      if (!p) { reasons.push(`Citation “${cit.source_title}” does not resolve to an authorized passage in your permitted scope.`); continue; }
      resolved++;
      if (!ai.has(cit.passage_id) || !disp.has(cit.passage_id)) reasons.push(`${p.source_title}: rights no longer permit AI processing and display.`);
      if (!p.text.includes(cit.quote)) reasons.push(`Quoted text does not match ${p.source_title}, ${p.locator} exactly.`);
      const bt = opts.blockText?.get(c.id);
      if (bt !== undefined && !bt.includes(cit.quote)) reasons.push('The quoted passage was edited out of or changed in the draft text.');
      if (overlap(c.issue, p.text) < 0.15) reasons.push(`${p.source_title}, ${p.locator} has weak relevance to the issue; confirm it supports the proposition.`);
      if (p.superseded) reasons.push(`${p.source_title}: a newer source version exists.`);
      if (p.warnings.some((w) => w.startsWith('Source status needs review'))) reasons.push(`${p.source_title}: source status needs review (stale check date).`);
    }
    const status: ClaimStatus = resolved === 0 ? 'unverified' : reasons.length === 0 ? 'verified' : 'needs_checking';
    return { ...c, status, reasons };
  });
}

// ---- Research pipeline (FD 06 §3) ----

export interface ResearchInput { question: string; matterId?: string; scopes?: Scope[]; sourceTypes?: string[]; court?: string; dateFrom?: string; dateTo?: string; idempotencyKey?: string }

export async function runResearch(ctx: Ctx, input: ResearchInput): Promise<{ queryId: string; result: ResearchResult }> {
  await requirePerm(ctx, 'research');
  const question = input.question.trim();
  if (question.length < 5) throw new DomainError('invalid_input', 'Enter a legal question.');
  if (input.matterId) await assertMatterAccess(ctx, input.matterId);
  const { issues, facts } = parseQuestion(question);
  const status = await aiStatus(ctx.tenantId);
  const filters = { scopes: input.scopes, sourceTypes: input.sourceTypes, court: input.court, dateFrom: input.dateFrom, dateTo: input.dateTo, matterId: input.matterId };

  const result: ResearchResult = {
    question, mode: status.available ? 'hybrid' : 'keyword', ai: 'ok', ai_message: null, issues, supplied_facts: facts, claims: [], hits: [],
    limitations: [
      'Facts stated in the question are treated as unverified user-supplied allegations.',
      'Search covers only rights-cleared sources in your permitted scope; coverage of Philippine law is not complete.',
    ], run_id: null,
  };

  // Retrieval runs without the AI provider (manual keyword search remains available during outages — FR-008).
  const allHits = new Map<string, PassageHit>();
  for (const issue of issues) {
    for (const h of await searchPassages(ctx, { query: issue, mode: result.mode, requireUse: 'display', ...filters, limit: 8 })) allHits.set(h.passage_id, h);
  }
  result.hits = [...allHits.values()].sort((a, b) => b.score - a.score).slice(0, 15)
    .map(({ passage_id, locator, text, source_id, source_title, authority, version_label, checked_at, warnings, scope, score }) =>
      ({ passage_id, locator, text, source_id, source_title, authority, version_label, checked_at, warnings, scope, score }));

  if (!status.available) {
    result.ai = status.simulation === 'outage' ? 'unavailable' : 'quota_exhausted';
    result.ai_message = 'AI analysis paused. Keyword results below are available for manual review.';
  } else {
    const run = await AiRun.start(ctx, 'research', input.matterId, input.idempotencyKey);
    result.run_id = run.id;
    try {
      for (const issue of issues) {
        const hitsForIssue = (await searchPassages(ctx, { query: issue, mode: 'hybrid', requireUse: 'ai_processing', ...filters, limit: 6 }));
        const composed = await run.step(`compose:${issues.indexOf(issue) + 1}`, 2, () =>
          composeClaims(issue, hitsForIssue, { fabricate: run.simulation === 'fabricated_citation' }));
        result.claims.push(...composed.claims);
        result.limitations.push(...composed.limitations);
      }
      if (run.simulation === 'malicious_instruction') {
        // Fault fixture: the "model" asks to email client files. The external action tool is disabled and refuses.
        const refusal = await requestExternalAction(ctx, { type: 'send_email', destination: 'external' });
        result.limitations.push(`A tool request from the AI step was refused: ${refusal.message}`);
      }
      await run.finish('completed');
    } catch (e) {
      if (!(e instanceof StepStop)) { await run.finish('failed', 'internal_error'); throw e; }
      result.ai = result.claims.length ? 'partial' : e.kind === 'quota_exhausted' ? 'quota_exhausted' : e.kind === 'timeout' ? 'timeout' : 'unavailable';
      result.ai_message = e.message;
      await run.finish(result.claims.length ? 'partial' : 'unavailable', e.kind);
    }
    // Independent check is deterministic and always runs (no AI needed), so partial results are still labelled correctly.
    result.claims = await checkClaims(ctx, result.claims);
  }

  const row = (await one<{ id: string }>(
    `insert into research_queries(tenant_id, user_id, matter_id, question, scope, result, ai_run_id) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [ctx.tenantId, ctx.userId, input.matterId ?? null, question, JSON.stringify(filters), JSON.stringify(result), result.run_id]))!;
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'research.query', targetType: input.matterId ? 'matter' : 'research', targetId: input.matterId ?? row.id,
    meta: { issues: issues.length, claims: result.claims.length, verified: result.claims.filter((c) => c.status === 'verified').length, ai: result.ai } });
  return { queryId: row.id, result };
}

export async function getResearch(ctx: Ctx, queryId: string) {
  const r = await one<{ id: string; matter_id: string | null; user_id: string; question: string; result: ResearchResult; created_at: Date }>(
    `select id, matter_id, user_id, question, result, created_at from research_queries where id = $1 and tenant_id = $2`, [queryId, ctx.tenantId]);
  if (!r) throw new DomainError('not_found_or_denied', 'Research not found.');
  if (r.matter_id) await assertMatterAccess(ctx, r.matter_id);
  else if (r.user_id !== ctx.userId) throw new DomainError('not_found_or_denied', 'Research not found.');
  return r;
}

export async function listRecentResearch(ctx: Ctx, limit = 10) {
  return q<{ id: string; question: string; matter_id: string | null; created_at: Date }>(
    `select r.id, r.question, r.matter_id, r.created_at from research_queries r
      where r.tenant_id = $1 and r.user_id = $2 order by r.created_at desc limit $3`, [ctx.tenantId, ctx.userId, limit]);
}
