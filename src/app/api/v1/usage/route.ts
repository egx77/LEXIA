import { api } from '@/lib/api';
import { usageSummary } from '@/lib/ai/gateway';
import { requirePerm } from '@/lib/authz';

/** GET /v1/usage — quotas, run costs, AI availability. No privileged matter contents. */
export const GET = api(async (ctx) => {
  await requirePerm(ctx, 'view_billing');
  const u = await usageSummary(ctx);
  return { ai: u.status, runs: u.runs.map(({ id, kind, status, units, quota_status, error_code, created_at }) => ({ id, kind, status, units, quota_status, error_code, created_at })) };
});
