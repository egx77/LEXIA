import { q, type Queryable } from './db';

export interface AuditInput {
  tenantId?: string | null;
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome?: 'ok' | 'denied' | 'failed';
  purpose?: string;
  /** Never put confidential document text or prompts here (FD 05 §4). */
  meta?: Record<string, unknown>;
}

export async function audit(e: AuditInput, t?: Queryable) {
  await q(
    `insert into audit_events (tenant_id, actor_id, action, target_type, target_id, outcome, purpose, meta)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.tenantId ?? null, e.actorId ?? null, e.action, e.targetType ?? null, e.targetId ?? null,
      e.outcome ?? 'ok', e.purpose ?? null, JSON.stringify(e.meta ?? {})],
    t,
  );
}

export interface AuditRow {
  id: number; actor_id: string | null; actor_name: string | null; action: string;
  target_type: string | null; target_id: string | null; outcome: string;
  meta: Record<string, unknown>; created_at: Date;
}

export async function listAudit(tenantId: string, limit = 200) {
  return q<AuditRow>(
    `select a.id, a.actor_id, u.name as actor_name, a.action, a.target_type, a.target_id, a.outcome, a.meta, a.created_at
       from audit_events a left join users u on u.id = a.actor_id
      where a.tenant_id = $1 order by a.id desc limit $2`,
    [tenantId, limit],
  );
}
