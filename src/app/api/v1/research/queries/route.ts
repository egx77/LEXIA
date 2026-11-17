import { api, body } from '@/lib/api';
import { runResearch, type ResearchInput } from '@/lib/research';

/** POST /v1/research/queries — question, scope, filters → cited passages (rights checked before retrieval; quota; audit). */
export const POST = api(async (ctx, req) => {
  const input = await body<ResearchInput>(req);
  const idem = req.headers.get('Idempotency-Key') ?? input.idempotencyKey;
  const { queryId, result } = await runResearch(ctx, { ...input, idempotencyKey: idem ?? undefined });
  return { query_id: queryId, ...result };
}, 201);
