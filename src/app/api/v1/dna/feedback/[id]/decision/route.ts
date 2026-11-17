import { api, body } from '@/lib/api';
import { decideFeedback } from '@/lib/dna';
import { DomainError } from '@/lib/errors';

/** POST /v1/dna/feedback/{id}/decision — accept / reject / undo a proposed profile update. Lawyer-only; versioned audit. */
export const POST = api(async (ctx, req, p) => {
  const { decision } = await body<{ decision: string }>(req);
  if (decision !== 'accept' && decision !== 'reject' && decision !== 'undo') throw new DomainError('invalid_input', 'decision must be accept, reject or undo');
  return { decision, profile_version: await decideFeedback(ctx, p.id, decision) };
});
