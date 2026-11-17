import { audit } from '../audit';
import type { Ctx } from '../authz';
import { one, q } from '../db';
import { DomainError } from '../errors';

/**
 * AI orchestration gateway (FD 05 §2, FD 06 §5).
 *
 * DEV-206/DEV-207 are pending, so no external model provider is wired. The only adapter is
 * "local-extractive-v1": a deterministic composer that assembles drafts strictly from retrieved,
 * rights-cleared passages and recorded matter facts. It never generates legal propositions of its own.
 * A provider adapter can be added behind the same contract once a privacy-reviewed provider is approved.
 *
 * Every AI step: checks availability (incl. test-environment fault simulation), checks and meters quota,
 * logs the step without confidential text, and leaves partial work recoverable (FR-021).
 */
export const MODEL_ADAPTER = 'local-extractive-v1';

export type Simulation = 'none' | 'outage' | 'timeout' | 'fabricated_citation' | 'malicious_instruction';
export type RunStatus = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'unavailable';

export interface AiStatus { available: boolean; reason: string | null; simulation: Simulation; quota: number; used: number; remaining: number; plan: string }

export function simulationAllowed() {
  return process.env.LEXIA_ENV !== 'production';
}

export async function aiStatus(tenantId: string): Promise<AiStatus> {
  const r = await one<{ ai_simulation: Simulation; ai_units_quota: number | null; ai_units_used: number | null; plan_code: string | null }>(
    `select t.ai_simulation, e.ai_units_quota, e.ai_units_used, e.plan_code from tenants t left join entitlements e on e.tenant_id = t.id where t.id = $1`, [tenantId]);
  const sim: Simulation = simulationAllowed() ? (r?.ai_simulation ?? 'none') : 'none';
  const quota = r?.ai_units_quota ?? 0;
  const used = r?.ai_units_used ?? 0;
  const remaining = Math.max(0, quota - used);
  let reason: string | null = null;
  if (sim === 'outage') reason = 'AI provider unavailable (simulated outage).';
  else if (remaining <= 0) reason = 'AI usage allowance exhausted for this period.';
  return { available: !reason, reason, simulation: sim, quota, used, remaining, plan: r?.plan_code ?? 'none' };
}

export async function setSimulation(ctx: Ctx, sim: Simulation) {
  if (!simulationAllowed()) throw new DomainError('forbidden', 'Fault simulation is disabled in production.');
  if (!ctx.roles.includes('firm_admin')) throw new DomainError('forbidden', 'Only a firm admin can change test simulation.');
  await q(`update tenants set ai_simulation = $2 where id = $1`, [ctx.tenantId, sim]);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'ai.simulation', meta: { simulation: sim } });
}

/** Test/pilot helper: set used units (e.g., to exhaust the allowance mid-task for AC-005). */
export async function setUsage(ctx: Ctx, used: number) {
  if (!simulationAllowed()) throw new DomainError('forbidden', 'Disabled in production.');
  if (!ctx.roles.includes('firm_admin')) throw new DomainError('forbidden', 'Only a firm admin can change usage.');
  await q(`update entitlements set ai_units_used = greatest(0, $2) where tenant_id = $1`, [ctx.tenantId, used]);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'usage.set_test', meta: { used } });
}

export class StepStop extends Error {
  constructor(public kind: 'unavailable' | 'quota_exhausted' | 'timeout' | 'cancelled', message: string) { super(message); }
}

export class AiRun {
  steps: { name: string; units: number; status: 'done' | 'stopped'; detail?: string }[] = [];
  units = 0;
  simulation: Simulation = 'none';
  private constructor(public id: string, public ctx: Ctx) {}

  static async start(ctx: Ctx, kind: string, matterId?: string | null, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await one<{ id: string; status: string }>(`select id, status from ai_runs where idempotency_key = $1 and tenant_id = $2`, [idempotencyKey, ctx.tenantId]);
      if (existing) throw new DomainError('conflict', `This request was already submitted (run ${existing.id.slice(0, 8)}, ${existing.status}).`);
    }
    const r = (await one<{ id: string }>(
      `insert into ai_runs(tenant_id, user_id, matter_id, kind, model_adapter, status, idempotency_key) values ($1,$2,$3,$4,$5,'running',$6) returning id`,
      [ctx.tenantId, ctx.userId, matterId ?? null, kind, MODEL_ADAPTER, idempotencyKey ?? null]))!;
    const run = new AiRun(r.id, ctx);
    run.simulation = (await aiStatus(ctx.tenantId)).simulation;
    return run;
  }

  /** Execute one metered AI step. Throws StepStop when the step cannot run; previous steps stay recorded. */
  async step<T>(name: string, units: number, fn: () => Promise<T> | T): Promise<T> {
    const st = await aiStatus(this.ctx.tenantId);
    if (st.simulation === 'outage') { this.stop(name, 'unavailable'); throw new StepStop('unavailable', 'AI drafting paused; your files and edits are saved.'); }
    if (st.simulation === 'timeout' && this.steps.length >= 1) { this.stop(name, 'timeout'); throw new StepStop('timeout', 'The AI step timed out; completed work was kept.'); }
    const reserved = await one(`update entitlements set ai_units_used = ai_units_used + $2
                                 where tenant_id = $1 and ai_units_used + $2 <= ai_units_quota returning 1`, [this.ctx.tenantId, units]);
    if (!reserved) { this.stop(name, 'quota_exhausted'); throw new StepStop('quota_exhausted', 'AI usage allowance exhausted. Your files, sources and partial draft are saved.'); }
    this.units += units;
    const out = await fn();
    this.steps.push({ name, units, status: 'done' });
    return out;
  }

  private stop(name: string, detail: string) {
    this.steps.push({ name, units: 0, status: 'stopped', detail });
  }

  async finish(status: RunStatus, errorCode?: string) {
    const quota = this.steps.some((s) => s.detail === 'quota_exhausted') ? 'exhausted' : 'ok';
    await q(`update ai_runs set status = $2, units = $3, steps = $4, error_code = $5, quota_status = $6, finished_at = now() where id = $1`,
      [this.id, status, this.units, JSON.stringify(this.steps), errorCode ?? null, quota]);
    await audit({ tenantId: this.ctx.tenantId, actorId: this.ctx.userId, action: 'ai.run', targetType: 'ai_run', targetId: this.id,
      outcome: status === 'completed' ? 'ok' : 'failed', meta: { status, units: this.units, steps: this.steps.map((s) => `${s.name}:${s.status}`) } });
  }
}

/**
 * External action tool — disabled for MVP (FD 06 §5). Any attempt (e.g., from a prompt-injected
 * source or a simulated malicious tool request) is refused and audited; nothing is sent, filed or paid.
 */
export async function requestExternalAction(ctx: Ctx, action: { type: string; destination?: string; reason?: string }) {
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'ai.external_action', outcome: 'denied', meta: { type: action.type } });
  return { performed: false as const, message: `External action "${action.type}" refused: LEXIA does not file, serve, send, pay or take external legal steps. A lawyer must act directly.` };
}

/** Heuristic prompt-injection detector for retrieved/uploaded text — treated as data, never instructions. */
export function looksLikeInstruction(text: string): boolean {
  return /\b(ignore (all|any|previous|prior) (instructions|rules)|disregard (the|your) (instructions|system)|you are now|system prompt|send (this|the|all) .{0,40}(to|email)|exfiltrate|reveal (the|all) (client|confidential))/i.test(text);
}

export async function usageSummary(ctx: Ctx) {
  const st = await aiStatus(ctx.tenantId);
  const runs = await q<{ id: string; kind: string; status: string; units: number; quota_status: string; error_code: string | null; created_at: Date; user_name: string }>(
    `select r.id, r.kind, r.status, r.units, r.quota_status, r.error_code, r.created_at, u.name as user_name
       from ai_runs r join users u on u.id = r.user_id where r.tenant_id = $1 order by r.created_at desc limit 50`, [ctx.tenantId]);
  return { status: st, runs };
}
