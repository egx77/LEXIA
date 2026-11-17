import { audit } from './audit';
import { one, q, type Queryable } from './db';
import { DomainError, MATTER_DENIED } from './errors';

/** FD 02 §2 roles. qa_editor is a LEXIA platform role (shared corpus only). */
export const ROLES = ['firm_admin', 'lawyer', 'legal_assistant', 'billing_staff', 'qa_editor'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  firm_admin: 'Firm owner/admin',
  lawyer: 'Lawyer',
  legal_assistant: 'Legal assistant',
  billing_staff: 'Billing/admin staff',
  qa_editor: 'LEXIA content/QA editor',
};

export interface Ctx {
  userId: string;
  name: string;
  email: string;
  tenantId: string;
  tenantName: string;
  tenantKind: 'firm' | 'platform';
  roles: Role[];
}

/** Deny-by-default permission matrix (FD 02 §2, FD 05 §2). */
const MATRIX = {
  manage_members: ['firm_admin'],
  view_billing: ['firm_admin', 'billing_staff'],
  view_audit: ['firm_admin'],
  simulate_ai: ['firm_admin'],
  create_matter: ['lawyer', 'firm_admin'],
  grant_matter: ['lawyer', 'firm_admin'],
  matter_work: ['lawyer', 'legal_assistant'],
  research: ['lawyer', 'legal_assistant'],
  draft: ['lawyer', 'legal_assistant'],
  approve_legal: ['lawyer'],
  confirm_deadline: ['lawyer'],
  export_matter: ['lawyer'],
  dna: ['lawyer'],
  manage_firm_sources: ['lawyer', 'firm_admin'],
  manage_core_sources: ['qa_editor'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof MATRIX;

export function can(ctx: Ctx, perm: Permission): boolean {
  return (MATRIX[perm] as readonly Role[]).some((r) => ctx.roles.includes(r));
}

export async function requirePerm(ctx: Ctx, perm: Permission): Promise<void> {
  if (!can(ctx, perm)) {
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: `permission.${perm}`, outcome: 'denied' });
    throw new DomainError('forbidden', 'Your role does not permit this action.');
  }
}

export interface MatterRow {
  id: string; tenant_id: string; client_id: string; client_name: string; title: string;
  practice_area: string; opposing_party: string | null; issues: string; status: string;
  version: number; created_at: Date; updated_at: Date;
}

/**
 * Matter access is checked independently of UI: same tenant AND explicit assignment.
 * Firm admins do not get automatic access to privileged matters (FD 02 §2).
 * Denials never reveal title or client metadata (FD 03 §8).
 */
export async function assertMatterAccess(ctx: Ctx, matterId: string, t?: Queryable): Promise<MatterRow> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(matterId);
  const row = isUuid
    ? await one<MatterRow>(
      `select m.*, c.name as client_name from matters m
         join clients c on c.id = m.client_id
         join matter_assignments a on a.matter_id = m.id and a.user_id = $3
        where m.id = $1 and m.tenant_id = $2`,
      [matterId, ctx.tenantId, ctx.userId], t)
    : undefined;
  if (!row) {
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'matter.access', targetType: 'matter',
      targetId: isUuid ? matterId : 'invalid', outcome: 'denied' }, t);
    throw new DomainError('not_found_or_denied', MATTER_DENIED);
  }
  return row;
}

export async function accessibleMatterIds(ctx: Ctx, t?: Queryable): Promise<string[]> {
  if (!can(ctx, 'matter_work')) return [];
  const rows = await q<{ id: string }>(
    `select m.id from matters m join matter_assignments a on a.matter_id = m.id
      where m.tenant_id = $1 and a.user_id = $2`, [ctx.tenantId, ctx.userId], t);
  return rows.map((r) => r.id);
}
