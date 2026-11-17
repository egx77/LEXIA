import { api, body } from '@/lib/api';
import { approveProfile, editDraftTraits, listProfiles, type DnaType } from '@/lib/dna';
import { DomainError } from '@/lib/errors';

function type(p: Record<string, string>): DnaType {
  if (p.type !== 'writing' && p.type !== 'reasoning') throw new DomainError('invalid_input', 'type must be writing or reasoning');
  return p.type;
}

export const GET = api(async (ctx, _req, p) => ({ versions: await listProfiles(ctx, type(p)) }));

/**
 * PATCH /v1/dna/profiles/{type} — edit a draft version (optimistic lock via `version`) and optionally approve it.
 * Body: { version: number, traits?: { [key]: { value?, enabled?, statement? } }, approve?: boolean }
 */
export const PATCH = api(async (ctx, req, p) => {
  const t = type(p);
  const b = await body<{ version: number; traits?: Record<string, { value?: string; enabled?: boolean; statement?: string }>; approve?: boolean }>(req);
  if (!Number.isInteger(b.version)) throw new DomainError('invalid_input', 'version is required');
  if (b.traits) await editDraftTraits(ctx, t, b.version, b.traits);
  if (b.approve) await approveProfile(ctx, t, b.version);
  return { type: t, version: b.version, approved: !!b.approve };
});
