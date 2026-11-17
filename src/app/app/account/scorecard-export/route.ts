import { audit } from '@/lib/audit';
import { DomainError } from '@/lib/errors';
import { scorecard, scorecardRows } from '@/lib/scorecard';
import { getCtx } from '@/lib/session';

/** FR-024 pilot evidence: scorecard as CSV. Admin only (view_audit); raw counts, no matter content or names. */
export async function GET() {
  const ctx = await getCtx();
  if (!ctx) return new Response('Sign in required.', { status: 401 });
  try {
    const rows = scorecardRows(await scorecard(ctx));
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'scorecard.export' });
    const csv = [['metric', 'value'], ['generated_at', new Date().toISOString()], ['tenant', ctx.tenantName], ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="lexia-scorecard.csv"', 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof DomainError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
