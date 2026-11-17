import { api, body } from '@/lib/api';
import { approveDraft, saveDraftVersion, submitForReview } from '@/lib/drafts';
import { DomainError } from '@/lib/errors';

/**
 * POST /v1/drafts/{id}/review — approve exact version (lawyer-only, immutable hash) or request revision.
 * Body: { action: 'approve', version, acknowledge_open_items } | { action: 'submit' } | { action: 'revise', base_version, texts }
 */
export const POST = api(async (ctx, req, p) => {
  const b = await body<{ action: string; version?: number; acknowledge_open_items?: boolean; base_version?: number; texts?: Record<string, string>; note?: string }>(req);
  if (b.action === 'approve') {
    if (!Number.isInteger(b.version)) throw new DomainError('invalid_input', 'version is required');
    return { approval_hash: await approveDraft(ctx, p.id, { version: b.version!, acknowledgeOpenItems: !!b.acknowledge_open_items }) };
  }
  if (b.action === 'submit') { await submitForReview(ctx, p.id); return { status: 'in_review' }; }
  if (b.action === 'revise') return { version: await saveDraftVersion(ctx, p.id, { baseVersion: b.base_version ?? -1, texts: b.texts ?? {}, note: b.note }) };
  throw new DomainError('invalid_input', 'action must be approve, submit or revise');
});
