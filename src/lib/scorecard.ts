import { requirePerm, type Ctx } from './authz';
import { one, q } from './db';
import type { DraftContent } from './drafts';
import { recognitionSummary } from './pilot';

/**
 * FR-024 legal quality & usage scorecard. Reports raw numerators/denominators only.
 * No targets: DEV-105/DEV-209 require a blinded lawyer baseline before any threshold is set.
 */
export async function scorecard(ctx: Ctx) {
  await requirePerm(ctx, 'view_audit');
  const versions = await q<{ draft_id: string; version: number; content: DraftContent; author_kind: string }>(
    `select v.draft_id, v.version, v.content, v.author_kind from draft_versions v join drafts d on d.id = v.draft_id where d.tenant_id = $1`, [ctx.tenantId]);
  const latest = new Map<string, { version: number; content: DraftContent }>();
  const firstAi = new Map<string, DraftContent>();
  for (const v of versions) {
    if (!latest.has(v.draft_id) || latest.get(v.draft_id)!.version < v.version) latest.set(v.draft_id, v);
    if (v.author_kind === 'ai' && v.version === 1) firstAi.set(v.draft_id, v.content);
  }
  let verified = 0, needs = 0, unverified = 0;
  for (const { content } of latest.values()) for (const blk of content.blocks) {
    if (blk.claim?.status === 'verified') verified++;
    else if (blk.claim?.status === 'needs_checking') needs++;
    else if (blk.claim?.status === 'unverified') unverified++;
  }
  // Editing burden: share of AI blocks changed or removed by the time of the latest version.
  let changedBlocks = 0, aiBlocks = 0;
  for (const [id, ai] of firstAi) {
    const l = latest.get(id)!.content;
    const lm = new Map(l.blocks.map((x) => [x.id, x.text]));
    for (const blk of ai.blocks) { aiBlocks++; if (lm.get(blk.id) !== blk.text) changedBlocks++; }
  }
  const drafts = (await one<{ total: number; approved: number; partial: number }>(
    `select count(*)::int as total, count(*) filter (where status = 'approved')::int as approved,
            count(*) filter (where generation_state <> 'complete')::int as partial from drafts where tenant_id = $1`, [ctx.tenantId]))!;
  const runs = await q<{ status: string; n: number; units: number }>(
    `select status, count(*)::int as n, coalesce(sum(units),0)::int as units from ai_runs where tenant_id = $1 group by status`, [ctx.tenantId]);
  const totalUnits = runs.reduce((a, r) => a + r.units, 0);
  const staleSources = (await one<{ n: number }>(
    `select count(*)::int as n from legal_sources where (tenant_id is null or tenant_id = $1) and (last_checked_at is null or last_checked_at < now() - interval '180 days')`, [ctx.tenantId]))!.n;
  const denials = (await one<{ n: number }>(`select count(*)::int as n from audit_events where tenant_id = $1 and outcome = 'denied'`, [ctx.tenantId]))!.n;
  const recovered = (await one<{ n: number }>(`select count(*)::int as n from drafts where tenant_id = $1 and generation_state in ('partial','manual')`, [ctx.tenantId]))!.n;
  const recognition = await recognitionSummary(ctx);
  return {
    recognition,
    citations: { verified, needs, unverified, total: verified + needs + unverified },
    editing: { changedBlocks, aiBlocks },
    drafts, runs, totalUnits,
    unitsPerApprovedDraft: drafts.approved ? +(totalUnits / drafts.approved).toFixed(1) : null,
    staleSources, denials, recovered,
  };
}

/** Flat metric list for pilot evidence export (FD 07 §7). Raw counts only. */
export function scorecardRows(s: Awaited<ReturnType<typeof scorecard>>): [string, string | number][] {
  const r = s.recognition;
  return [
    ['citations.verified', s.citations.verified], ['citations.needs_checking', s.citations.needs], ['citations.unverified', s.citations.unverified], ['citations.total', s.citations.total],
    ['editing.ai_blocks_changed', s.editing.changedBlocks], ['editing.ai_blocks_total', s.editing.aiBlocks],
    ['drafts.total', s.drafts.total], ['drafts.approved', s.drafts.approved], ['drafts.partial_or_manual', s.drafts.partial], ['drafts.recovered_after_ai_stop', s.recovered],
    ...s.runs.flatMap((x): [string, number][] => [[`ai_runs.${x.status}.count`, x.n], [`ai_runs.${x.status}.units`, x.units]]),
    ['ai_units.total', s.totalUnits], ['ai_units.per_approved_draft', s.unitsPerApprovedDraft ?? ''],
    ['sources.needing_recheck', s.staleSources], ['audit.denied_attempts', s.denials],
    ['blind_review.completed', r.completed],
    ['blind_review.voice.picked_personalized', r.voice.personalized], ['blind_review.voice.picked_neutral', r.voice.neutral], ['blind_review.voice.unsure', r.voice.unsure],
    ['blind_review.approach.picked_personalized', r.approach.personalized], ['blind_review.approach.picked_neutral', r.approach.neutral], ['blind_review.approach.unsure', r.approach.unsure],
    ['blind_review.legal_issue.none', r.legal.none], ['blind_review.legal_issue.personalized', r.legal.personalized], ['blind_review.legal_issue.neutral', r.legal.neutral], ['blind_review.legal_issue.both', r.legal.both],
    ['blind_review.edit_effort.none', r.effort.none], ['blind_review.edit_effort.light', r.effort.light], ['blind_review.edit_effort.moderate', r.effort.moderate], ['blind_review.edit_effort.heavy', r.effort.heavy],
  ];
}
