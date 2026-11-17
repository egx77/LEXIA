import { audit } from './audit';
import { requirePerm, type Ctx } from './authz';
import { one, q } from './db';
import { DomainError } from './errors';

/** FR-023 / FR-019. Policy text is pending legal review; plans are unpriced placeholders (DEV-104). */

export interface PolicyRow { id: string; kind: string; version: string; review_status: string; body: string }

export const POLICY_TITLES: Record<string, string> = {
  terms: 'Terms of Service', privacy: 'Privacy Notice', ai_disclosure: 'AI Limitations Disclosure',
  subscription: 'Subscription & Cancellation Policy', dna_notice: 'Lawyer DNA Consent Notice',
};

export async function currentPolicies() {
  return q<PolicyRow>(`select distinct on (kind) id, kind, version, review_status, body from policy_documents order by kind, version desc`);
}

export async function policy(kind: string) {
  return one<PolicyRow>(`select id, kind, version, review_status, body from policy_documents where kind = $1 order by version desc limit 1`, [kind]);
}

export async function pendingAcceptances(userId: string) {
  return q<PolicyRow>(
    `select p.* from (select distinct on (kind) * from policy_documents where kind in ('terms','privacy','ai_disclosure') order by kind, version desc) p
      where not exists (select 1 from policy_acceptances a where a.user_id = $1 and a.policy_id = p.id)`, [userId]);
}

export async function acceptPolicies(ctx: Ctx, policyIds: string[]) {
  const pending = await pendingAcceptances(ctx.userId);
  const missing = pending.filter((p) => !policyIds.includes(p.id));
  if (missing.length) throw new DomainError('invalid_input', 'Please review and accept each listed policy.');
  for (const p of pending) await q(`insert into policy_acceptances(user_id, policy_id) values ($1,$2) on conflict do nothing`, [ctx.userId, p.id]);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'policy.accept', meta: { versions: pending.map((p) => `${p.kind}@${p.version}`) } });
}

export async function listPlans() {
  return q<{ code: string; name: string; summary: string; placeholder_ai_units: number }>(`select code, name, summary, placeholder_ai_units from plans order by placeholder_ai_units`);
}

export async function entitlement(tenantId: string) {
  return one<{ plan_code: string; plan_name: string; ai_units_quota: number; ai_units_used: number; payment_state: string; period_start: string }>(
    `select e.plan_code, p.name as plan_name, e.ai_units_quota, e.ai_units_used, e.payment_state, to_char(e.period_start,'YYYY-MM-DD') as period_start
       from entitlements e join plans p on p.code = e.plan_code where e.tenant_id = $1`, [tenantId]);
}

/**
 * Select a placeholder plan. No payment is taken: paid checkout stays disabled until a processor, tax and terms are approved.
 * Idempotent — selecting the current plan again changes nothing (no duplicate charge path exists).
 */
export async function selectPlan(ctx: Ctx, code: string) {
  await requirePerm(ctx, 'manage_members');
  const plan = await one<{ code: string; placeholder_ai_units: number }>(`select code, placeholder_ai_units from plans where code = $1`, [code]);
  if (!plan) throw new DomainError('invalid_input', 'Unknown plan.');
  const cur = await entitlement(ctx.tenantId);
  if (cur?.plan_code === code) return false;
  await q(`insert into entitlements(tenant_id, plan_code, ai_units_quota, payment_state) values ($1,$2,$3, $4)
           on conflict (tenant_id) do update set plan_code = excluded.plan_code, ai_units_quota = excluded.ai_units_quota, payment_state = excluded.payment_state`,
  [ctx.tenantId, code, plan.placeholder_ai_units, code === 'pilot' ? 'not_required' : 'pending_provider_approval']);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'plan.select', meta: { plan: code, payment: 'none_taken' } });
  return true;
}

export async function recordDemoRequest(input: { name: string; email: string; firm?: string; message?: string }) {
  if (!input.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new DomainError('invalid_input', 'Enter your name and a valid email.');
  await q(`insert into demo_requests(name, email, firm, message) values ($1,$2,$3,$4)`, [input.name.trim(), input.email.trim(), input.firm?.trim() || null, input.message?.trim()?.slice(0, 2000) || null]);
}
