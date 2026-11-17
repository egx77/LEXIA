import { randomInt } from 'node:crypto';
import { audit } from './audit';
import { requirePerm, type Ctx } from './authz';
import { one, q } from './db';
import type { Block, DraftContent } from './drafts';
import { DomainError } from './errors';

/**
 * FR-036 blinded recognition review (FD 07 TC-030, FD 08 S6 pilot hardening).
 *
 * A consenting lawyer compares two unlabeled versions of their own draft: the version written with their
 * Lawyer DNA and the neutral version generated from the same facts and sources. The A/B order is chosen at
 * random on the server when the review starts and is never sent to the browser. Results are reported only
 * as raw counts; DEV-209 forbids setting a target before the pilot baseline exists.
 */
export type ABPick = 'a' | 'b' | 'unsure';
export type LegalIssue = 'none' | 'a' | 'b' | 'both';
export type EditEffort = 'none' | 'light' | 'moderate' | 'heavy';
const PICKS: ABPick[] = ['a', 'b', 'unsure'];
const ISSUES: LegalIssue[] = ['none', 'a', 'b', 'both'];
const EFFORTS: EditEffort[] = ['none', 'light', 'moderate', 'heavy'];

export interface EligibleDraft { id: string; title: string; dna_mode: string; created_at: Date; review_id: string | null; completed_at: Date | null }

/** Own drafts that were written with DNA and still have their neutral comparison. */
export async function eligibleDrafts(ctx: Ctx): Promise<EligibleDraft[]> {
  await requirePerm(ctx, 'dna');
  return q<EligibleDraft>(
    `select d.id, d.title, d.dna_mode, d.created_at, r.id as review_id, r.completed_at
       from drafts d left join pilot_reviews r on r.draft_id = d.id and r.reviewer_id = $2
      where d.tenant_id = $1 and d.created_by = $2 and d.dna_mode <> 'neutral' and d.neutral_content is not null
        and (d.matter_id is null or exists (select 1 from matter_assignments a where a.matter_id = d.matter_id and a.user_id = $2))
      order by d.created_at desc limit 50`, [ctx.tenantId, ctx.userId]);
}

export async function startReview(ctx: Ctx, draftId: string): Promise<string> {
  await requirePerm(ctx, 'dna');
  const ok = (await eligibleDrafts(ctx)).find((d) => d.id === draftId);
  if (!ok) throw new DomainError('not_found_or_denied', 'This draft cannot be reviewed blind. Only your own drafts written with Lawyer DNA qualify.');
  if (ok.review_id) return ok.review_id;
  const row = (await one<{ id: string }>(
    `insert into pilot_reviews(tenant_id, draft_id, reviewer_id, personalized_is_a) values ($1,$2,$3,$4)
     on conflict (draft_id, reviewer_id) do update set draft_id = excluded.draft_id returning id`,
    [ctx.tenantId, draftId, ctx.userId, randomInt(2) === 1]))!;
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'pilot.review_start', targetType: 'draft', targetId: draftId });
  return row.id;
}

interface ReviewRow { id: string; draft_id: string; title: string; personalized_is_a: boolean; completed_at: Date | null; personalized: DraftContent; neutral: DraftContent }

async function loadOwn(ctx: Ctx, reviewId: string): Promise<ReviewRow> {
  await requirePerm(ctx, 'dna');
  if (!/^[0-9a-f-]{36}$/i.test(reviewId)) throw new DomainError('not_found_or_denied', 'Review not found.');
  const r = await one<ReviewRow>(
    `select r.id, r.draft_id, d.title, r.personalized_is_a, r.completed_at, v.content as personalized, d.neutral_content as neutral
       from pilot_reviews r join drafts d on d.id = r.draft_id
       join draft_versions v on v.draft_id = d.id and v.version = 1
      where r.id = $1 and r.tenant_id = $2 and r.reviewer_id = $3`, [reviewId, ctx.tenantId, ctx.userId]);
  if (!r) throw new DomainError('not_found_or_denied', 'Review not found.');
  return r;
}

/** Text only: no labels, personalization notes or citation badges that could reveal which version is which. */
const blind = (c: DraftContent): Pick<Block, 'kind' | 'text'>[] =>
  c.blocks.filter((b) => b.kind !== 'note').map((b) => ({ kind: b.kind, text: b.text }));

export async function getReview(ctx: Ctx, reviewId: string) {
  const r = await loadOwn(ctx, reviewId);
  const [a, b] = r.personalized_is_a ? [r.personalized, r.neutral] : [r.neutral, r.personalized];
  return { id: r.id, title: r.title, completed: !!r.completed_at, a: blind(a), b: blind(b) };
}

export interface ReviewAnswers { voice: string; approach: string; legalIssue: string; effort: string; comment?: string; consent: boolean }

export async function submitReview(ctx: Ctx, reviewId: string, ans: ReviewAnswers) {
  const r = await loadOwn(ctx, reviewId);
  if (r.completed_at) throw new DomainError('conflict', 'This review is already recorded and cannot be changed.');
  if (!ans.consent) throw new DomainError('consent_required', 'Tick the consent box to record this review for the pilot. Nothing is saved without it.');
  if (!PICKS.includes(ans.voice as ABPick) || !PICKS.includes(ans.approach as ABPick)) throw new DomainError('invalid_input', 'Answer both comparison questions.');
  if (!ISSUES.includes(ans.legalIssue as LegalIssue) || !EFFORTS.includes(ans.effort as EditEffort)) throw new DomainError('invalid_input', 'Answer the legal-accuracy and editing questions.');
  await q(`update pilot_reviews set voice_pick = $2, approach_pick = $3, legal_issue = $4, edit_effort = $5, comment = $6,
            consent_pilot_use = true, completed_at = now() where id = $1 and completed_at is null`,
    [r.id, ans.voice, ans.approach, ans.legalIssue, ans.effort, ans.comment?.trim().slice(0, 2000) || null]);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'pilot.review_complete', targetType: 'draft', targetId: r.draft_id });
  // Only now is the order revealed to the reviewer.
  return { personalizedWas: r.personalized_is_a ? 'A' : 'B' };
}

/** Firm-level raw counts for the scorecard. No reviewer identities and no free-text comments. */
export async function recognitionSummary(ctx: Ctx) {
  await requirePerm(ctx, 'view_audit');
  const rows = await q<{ personalized_is_a: boolean; voice_pick: ABPick; approach_pick: ABPick; legal_issue: LegalIssue; edit_effort: EditEffort }>(
    `select personalized_is_a, voice_pick, approach_pick, legal_issue, edit_effort from pilot_reviews
      where tenant_id = $1 and completed_at is not null and consent_pilot_use`, [ctx.tenantId]);
  const side = (p: ABPick, persA: boolean) => (p === 'unsure' ? 'unsure' : (p === 'a') === persA ? 'personalized' : 'neutral');
  const count = () => ({ personalized: 0, neutral: 0, unsure: 0 });
  const voice = count(), approach = count();
  const legal = { none: 0, personalized: 0, neutral: 0, both: 0 };
  const effort: Record<EditEffort, number> = { none: 0, light: 0, moderate: 0, heavy: 0 };
  for (const r of rows) {
    voice[side(r.voice_pick, r.personalized_is_a)]++;
    approach[side(r.approach_pick, r.personalized_is_a)]++;
    legal[r.legal_issue === 'a' || r.legal_issue === 'b' ? side(r.legal_issue, r.personalized_is_a) as 'personalized' | 'neutral' : r.legal_issue]++;
    effort[r.edit_effort]++;
  }
  return { completed: rows.length, voice, approach, legal, effort };
}
