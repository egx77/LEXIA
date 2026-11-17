import { api, body } from '@/lib/api';
import { generateDraft, listDrafts, type GenerateInput } from '@/lib/drafts';

/** POST /v1/drafts — matter, document type, DNA mode, selected sources → draft (context scope, token budget, source gates). */
export const POST = api(async (ctx, req) => {
  const input = await body<GenerateInput>(req);
  const out = await generateDraft(ctx, { ...input, idempotencyKey: req.headers.get('Idempotency-Key') ?? input.idempotencyKey });
  return { draft_id: out.draftId, state: out.state, message: out.message };
}, 201);

export const GET = api(async (ctx) => ({ drafts: await listDrafts(ctx) }));
