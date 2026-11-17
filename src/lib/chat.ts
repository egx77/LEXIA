import { aiStatus } from './ai/gateway';
import { requirePerm, type Ctx } from './authz';
import { q } from './db';
import { runResearch, type ResearchResult } from './research';

/**
 * FR-017 conversational workspace. Plain-language questions are answered only through the
 * grounded research pipeline (no free-form generation); every answer shows AI/credit status and the manual route.
 */
export interface ChatContent { text: string; research_id?: string; result?: Pick<ResearchResult, 'claims' | 'ai' | 'ai_message' | 'limitations' | 'mode'> }

export async function chatHistory(ctx: Ctx, matterId?: string) {
  return q<{ id: string; role: 'user' | 'assistant'; content: ChatContent; created_at: Date }>(
    `select id, role, content, created_at from chat_messages where tenant_id = $1 and user_id = $2 and matter_id is not distinct from $3::uuid order by created_at asc limit 100`,
    [ctx.tenantId, ctx.userId, matterId ?? null]);
}

export async function sendChat(ctx: Ctx, text: string, matterId?: string) {
  await requirePerm(ctx, 'research');
  const msg = text.trim();
  if (!msg) return;
  await q(`insert into chat_messages(tenant_id, user_id, matter_id, role, content) values ($1,$2,$3,'user',$4)`, [ctx.tenantId, ctx.userId, matterId ?? null, JSON.stringify({ text: msg })]);
  const st = await aiStatus(ctx.tenantId);
  const { queryId, result } = await runResearch(ctx, { question: msg, matterId });
  const verified = result.claims.filter((c) => c.status === 'verified').length;
  const reply = !st.available
    ? `${st.reason} I ran a keyword search instead — ${result.hits.length} passage(s) are available to review manually.`
    : result.claims.length
      ? `I found ${result.claims.length} proposition(s); ${verified} resolve to a verified source passage. Items marked “Needs checking” or “Unverified” require your review.`
      : 'No authorized source found for this question. Try manual source search or adjust the scope.';
  await q(`insert into chat_messages(tenant_id, user_id, matter_id, role, content) values ($1,$2,$3,'assistant',$4)`,
    [ctx.tenantId, ctx.userId, matterId ?? null, JSON.stringify({ text: reply, research_id: queryId,
      result: { claims: result.claims, ai: result.ai, ai_message: result.ai_message, limitations: result.limitations, mode: result.mode } })]);
}
