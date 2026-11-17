import { audit } from './audit';
import { accessibleMatterIds, assertMatterAccess, can, requirePerm, type Ctx } from './authz';
import { one, q, tx } from './db';
import { DomainError } from './errors';

/**
 * FR-005 Tasks & deadlines. Rules:
 *  - AI/suggested items never become "confirmed" without a lawyer's explicit verification.
 *  - LEXIA does not compute statutory periods (FD 09 §3: do not invent legal rules); suggestions
 *    name the triggering event and leave the date for the lawyer to determine and confirm.
 *  - Reminders are deterministic and de-duplicated by (task, date).
 */

export interface TaskRow {
  id: string; matter_id: string; matter_title: string; title: string; kind: 'task' | 'deadline'; origin: 'manual' | 'suggested';
  owner_id: string | null; owner_name: string | null; due_at: Date | null; timezone: string;
  verification_status: 'unverified' | 'confirmed' | 'rejected'; verified_by_name: string | null; verified_at: Date | null;
  evidence_note: string | null; status: 'open' | 'done'; created_at: Date;
}

const TASK_SELECT = `select t.*, m.title as matter_title, o.name as owner_name, vb.name as verified_by_name
  from tasks t join matters m on m.id = t.matter_id left join users o on o.id = t.owner_id left join users vb on vb.id = t.verified_by`;

/** Interpret a datetime-local value as Philippine time (UTC+8, no DST). */
export function manilaToUtc(local: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(local)) throw new DomainError('invalid_input', 'Enter a valid date.');
  const withTime = local.length === 10 ? `${local}T17:00` : local;
  return new Date(`${withTime}:00+08:00`);
}

export function formatManila(d: Date | null | string): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)) + ' PHT';
}

export async function createTask(ctx: Ctx, matterId: string, input: { title: string; kind: 'task' | 'deadline'; dueLocal?: string; ownerId?: string; verifiedByMe?: boolean; evidenceNote?: string }) {
  await requirePerm(ctx, 'matter_work');
  if (!input.title.trim()) throw new DomainError('invalid_input', 'Title is required.');
  const due = input.dueLocal ? manilaToUtc(input.dueLocal) : null;
  // A manually entered deadline is confirmed only if a lawyer explicitly attests verification.
  const confirm = input.kind === 'deadline' && !!input.verifiedByMe && !!due;
  if (confirm && !can(ctx, 'confirm_deadline')) throw new DomainError('forbidden', 'Only a lawyer can confirm a deadline.');
  if (confirm && !input.evidenceNote?.trim()) throw new DomainError('invalid_input', 'Record the basis you verified for this deadline.');
  return tx(async (t) => {
    await assertMatterAccess(ctx, matterId, t);
    if (input.ownerId && input.ownerId !== ctx.userId) {
      // Delegation only to an active member already assigned to this matter (no access by assignment side-effect).
      const ok = await one(`select 1 from matter_assignments a join memberships ms on ms.user_id = a.user_id and ms.tenant_id = $3 and ms.status = 'active'
                             where a.matter_id = $1 and a.user_id = $2`, [matterId, input.ownerId, ctx.tenantId], t);
      if (!ok) throw new DomainError('invalid_input', 'The owner must be a team member assigned to this matter.');
    }
    const status = input.kind === 'task' ? 'confirmed' : confirm ? 'confirmed' : 'unverified';
    const r = (await one<{ id: string }>(
      `insert into tasks(tenant_id, matter_id, title, kind, origin, owner_id, due_at, verification_status, verified_by, verified_at, evidence_note, created_by)
       values ($1,$2,$3,$4,'manual',$5,$6,$7,$8,$9,$10,$11) returning id`,
      [ctx.tenantId, matterId, input.title.trim(), input.kind, input.ownerId || ctx.userId, due, status,
        confirm ? ctx.userId : null, confirm ? new Date() : null, input.evidenceNote?.trim() || null, ctx.userId], t))!;
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'task.create', targetType: 'matter', targetId: matterId, meta: { task_id: r.id, kind: input.kind, status } }, t);
    if (status === 'confirmed' && due) await scheduleReminders(r.id, due, t);
    return r.id;
  });
}

async function scheduleReminders(taskId: string, due: Date, t?: Parameters<typeof q>[2]) {
  // Deterministic: 3 days before and on the day (Manila date). Unique (task, date) prevents duplicates.
  for (const daysBefore of [3, 0]) {
    const d = new Date(due.getTime() - daysBefore * 86400000);
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d);
    await q(`insert into reminders(task_id, remind_on) values ($1,$2) on conflict do nothing`, [taskId, ymd], t);
  }
}

async function loadTaskForWrite(ctx: Ctx, taskId: string, t: Parameters<typeof q>[2]) {
  const task = await one<{ id: string; matter_id: string; kind: string; due_at: Date | null; verification_status: string }>(
    `select id, matter_id, kind, due_at, verification_status from tasks where id = $1 and tenant_id = $2`, [taskId, ctx.tenantId], t);
  if (!task) throw new DomainError('not_found_or_denied', 'Task not found.');
  await assertMatterAccess(ctx, task.matter_id, t);
  return task;
}

/** Lawyer verification of a suggested/unverified deadline (AC-007). */
export async function confirmDeadline(ctx: Ctx, taskId: string, input: { dueLocal: string; evidenceNote: string }) {
  await requirePerm(ctx, 'confirm_deadline');
  if (!input.evidenceNote.trim()) throw new DomainError('invalid_input', 'Record the basis you verified for this deadline.');
  const due = manilaToUtc(input.dueLocal);
  await tx(async (t) => {
    const task = await loadTaskForWrite(ctx, taskId, t);
    await q(`update tasks set due_at = $2, verification_status = 'confirmed', verified_by = $3, verified_at = now(), evidence_note = $4
              where id = $1`, [taskId, due, ctx.userId, input.evidenceNote.trim()], t);
    await scheduleReminders(taskId, due, t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'deadline.confirm', targetType: 'matter', targetId: task.matter_id, meta: { task_id: taskId } }, t);
  });
}

export async function rejectSuggestion(ctx: Ctx, taskId: string) {
  await requirePerm(ctx, 'matter_work');
  await tx(async (t) => {
    const task = await loadTaskForWrite(ctx, taskId, t);
    if (task.verification_status === 'confirmed') throw new DomainError('invalid_input', 'Confirmed items cannot be rejected; mark done instead.');
    await q(`update tasks set verification_status = 'rejected', status = 'done' where id = $1`, [taskId], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'task.reject', targetType: 'matter', targetId: task.matter_id, meta: { task_id: taskId } }, t);
  });
}

export async function setTaskStatus(ctx: Ctx, taskId: string, status: 'open' | 'done') {
  await requirePerm(ctx, 'matter_work');
  await tx(async (t) => {
    const task = await loadTaskForWrite(ctx, taskId, t);
    await q(`update tasks set status = $2 where id = $1`, [taskId, status], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: `task.${status}`, targetType: 'matter', targetId: task.matter_id, meta: { task_id: taskId } }, t);
  });
}

export async function listTasks(ctx: Ctx, opts: { matterId?: string; includeDone?: boolean } = {}) {
  const ids = opts.matterId ? [(await assertMatterAccess(ctx, opts.matterId)).id] : await accessibleMatterIds(ctx);
  if (!ids.length) return [];
  return q<TaskRow>(
    `${TASK_SELECT} where t.tenant_id = $1 and t.matter_id = any($2::uuid[]) and ($3 or t.status = 'open')
      order by (t.verification_status = 'confirmed') desc, t.due_at nulls last, t.created_at`,
    [ctx.tenantId, ids, !!opts.includeDone]);
}

export async function upcomingReminders(ctx: Ctx) {
  const ids = await accessibleMatterIds(ctx);
  if (!ids.length) return [];
  return q<{ remind_on: string; title: string; matter_title: string; due_at: Date }>(
    `select to_char(r.remind_on,'YYYY-MM-DD') as remind_on, t.title, m.title as matter_title, t.due_at
       from reminders r join tasks t on t.id = r.task_id join matters m on m.id = t.matter_id
      where t.tenant_id = $1 and t.matter_id = any($2::uuid[]) and t.status = 'open' and t.verification_status = 'confirmed'
        and r.remind_on between current_date - 1 and current_date + 14
      order by r.remind_on`, [ctx.tenantId, ids]);
}

/**
 * Suggest tasks from matter facts. Deterministic, provenance-linked, never dated by LEXIA.
 * Runs without the AI provider so it remains available during outages.
 */
const TRIGGERS: { re: RegExp; title: (s: string) => string }[] = [
  { re: /\b(received|served|service of)\b.*\b(summons|complaint|petition|notice|order|decision|resolution|judgment)\b/i,
    title: (s) => `Determine and confirm the responsive deadline triggered by: “${s}”` },
  { re: /\b(hearing|conference|mediation|arraignment)\b/i,
    title: (s) => `Confirm schedule and prepare for event: “${s}”` },
  { re: /\b(demand letter|notice of termination|termination|dismiss(ed|al))\b/i,
    title: (s) => `Review whether a reply or filing period applies to: “${s}”` },
];

export async function suggestTasks(ctx: Ctx, matterId: string) {
  await requirePerm(ctx, 'matter_work');
  return tx(async (t) => {
    await assertMatterAccess(ctx, matterId, t);
    const facts = await q<{ id: string; statement: string; occurred_on: string | null; classification: string }>(
      `select f.id, f.statement, to_char(f.occurred_on,'YYYY-MM-DD') as occurred_on, f.classification from facts f
        where f.matter_id = $1 and not exists (select 1 from tasks t where t.source_fact_id = f.id)`, [matterId], t);
    let created = 0;
    for (const f of facts) {
      const hit = TRIGGERS.find((tr) => tr.re.test(f.statement));
      if (!hit) continue;
      const short = f.statement.length > 120 ? f.statement.slice(0, 117) + '…' : f.statement;
      await q(`insert into tasks(tenant_id, matter_id, title, kind, origin, verification_status, evidence_note, source_fact_id, owner_id)
               values ($1,$2,$3,'deadline','suggested','unverified',$4,$5,$6)`,
      [ctx.tenantId, matterId, hit.title(short),
        `Suggested from ${f.classification} recorded${f.occurred_on ? ` for ${f.occurred_on}` : ''}. LEXIA did not compute a date — verify the applicable rule and period before relying on any deadline.`,
        f.id, ctx.userId], t);
      created++;
    }
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'task.suggest', targetType: 'matter', targetId: matterId, meta: { created } }, t);
    return created;
  });
}

/** J-003: save a lawyer-reviewed daily action plan. */
export async function saveActionPlan(ctx: Ctx, taskIds: string[]) {
  const tasks = await listTasks(ctx);
  const allowed = new Map(tasks.map((x) => [x.id, x]));
  const items = taskIds.filter((id) => allowed.has(id)).map((id, i) => {
    const x = allowed.get(id)!;
    return { order: i + 1, task_id: id, title: x.title, matter: x.matter_title, due_at: x.due_at, verification_status: x.verification_status };
  });
  if (!items.length) throw new DomainError('invalid_input', 'Select at least one task for the plan.');
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const r = (await one<{ id: string }>(`insert into action_plans(tenant_id, user_id, plan_date, items) values ($1,$2,$3,$4) returning id`,
    [ctx.tenantId, ctx.userId, ymd, JSON.stringify(items)]))!;
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'action_plan.save', meta: { items: items.length } });
  return r.id;
}

export async function latestActionPlan(ctx: Ctx) {
  return one<{ id: string; plan_date: string; items: { order: number; task_id: string; title: string; matter: string; verification_status: string }[]; created_at: Date }>(
    `select id, to_char(plan_date,'YYYY-MM-DD') as plan_date, items, created_at from action_plans
      where tenant_id = $1 and user_id = $2 order by created_at desc limit 1`, [ctx.tenantId, ctx.userId]);
}

/** Suggested priority ordering — a deterministic suggestion the lawyer accepts or edits. */
export function suggestPriority(tasks: TaskRow[]): TaskRow[] {
  const score = (t: TaskRow) => {
    let s = 0;
    if (t.kind === 'deadline' && t.verification_status === 'confirmed' && t.due_at) {
      const days = (new Date(t.due_at).getTime() - Date.now()) / 86400000;
      s += days < 0 ? 1000 : Math.max(0, 500 - days * 20);
    }
    if (t.verification_status === 'unverified' && t.kind === 'deadline') s += 300; // needs verification soon
    if (t.kind === 'task' && t.due_at) s += Math.max(0, 200 - ((new Date(t.due_at).getTime() - Date.now()) / 86400000) * 10);
    return s;
  };
  return [...tasks].filter((t) => t.status === 'open').sort((a, b) => score(b) - score(a));
}
