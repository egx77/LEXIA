import { can, type Ctx } from './authz';
import { q } from './db';
import { scoreText, wantsContinue } from './catalog';
import { DOC_TYPES } from './drafts';

/**
 * Work Desk data: "Continue Work" items and "Your attention is needed".
 * Every query is scoped like the underlying modules: tenant + matter assignment, or own unscoped work.
 */

export type WorkKind = 'draft' | 'research' | 'matter';
export interface WorkItem {
  kind: WorkKind; id: string; title: string; state: string; tone: 'ok' | 'warn' | 'info' | 'neutral';
  href: string; matterId: string | null; matterTitle: string | null; clientName: string | null; at: Date; done: boolean;
}

const DRAFT_STATE: Record<string, [string, WorkItem['tone']]> = {
  draft: ['Draft in progress', 'info'], in_review: ['Awaiting lawyer review', 'warn'], approved: ['Approved', 'ok'],
};

export async function continueItems(ctx: Ctx): Promise<WorkItem[]> {
  if (!can(ctx, 'matter_work') && !can(ctx, 'research')) return [];
  const [drafts, research, matters] = await Promise.all([
    can(ctx, 'draft') ? q<{ id: string; title: string; doc_type: string; status: string; generation_state: string; matter_id: string | null; matter_title: string | null; client_name: string | null; at: Date }>(
      `select d.id, d.title, d.doc_type, d.status, d.generation_state, d.matter_id, m.title as matter_title, c.name as client_name,
              coalesce((select max(v.created_at) from draft_versions v where v.draft_id = d.id), d.created_at) as at
         from drafts d left join matters m on m.id = d.matter_id left join clients c on c.id = m.client_id
        where d.tenant_id = $1
          and ((d.matter_id is null and d.created_by = $2) or exists (select 1 from matter_assignments a where a.matter_id = d.matter_id and a.user_id = $2))`,
      [ctx.tenantId, ctx.userId]) : [],
    q<{ id: string; question: string; matter_id: string | null; matter_title: string | null; client_name: string | null; created_at: Date }>(
      `select r.id, r.question, r.matter_id, m.title as matter_title, c.name as client_name, r.created_at
         from research_queries r left join matters m on m.id = r.matter_id left join clients c on c.id = m.client_id
        where r.tenant_id = $1 and r.user_id = $2
          and (r.matter_id is null or exists (select 1 from matter_assignments a where a.matter_id = r.matter_id and a.user_id = $2))
        order by r.created_at desc limit 50`, [ctx.tenantId, ctx.userId]),
    can(ctx, 'matter_work') ? q<{ id: string; title: string; status: string; client_name: string; practice_area: string; updated_at: Date; open_tasks: number }>(
      `select m.id, m.title, m.status, c.name as client_name, m.practice_area, m.updated_at,
              (select count(*)::int from tasks t where t.matter_id = m.id and t.status = 'open') as open_tasks
         from matters m join clients c on c.id = m.client_id join matter_assignments a on a.matter_id = m.id and a.user_id = $2
        where m.tenant_id = $1`, [ctx.tenantId, ctx.userId]) : [],
  ]);

  const items: WorkItem[] = [];
  for (const d of drafts) {
    let [state, tone] = DRAFT_STATE[d.status] ?? [d.status, 'neutral' as const];
    if (d.status === 'draft' && d.generation_state !== 'complete') { state = d.generation_state === 'manual' ? 'Unfinished — manual template' : 'Unfinished — AI stopped part-way'; tone = 'warn'; }
    items.push({ kind: 'draft', id: d.id, title: d.title, state: `${DOC_TYPES[d.doc_type as keyof typeof DOC_TYPES] ?? 'Document'} · ${state}`, tone,
      href: `/app/drafts/${d.id}`, matterId: d.matter_id, matterTitle: d.matter_title, clientName: d.client_name, at: new Date(d.at), done: d.status === 'approved' });
  }
  for (const r of research) {
    items.push({ kind: 'research', id: r.id, title: r.question.length > 90 ? `${r.question.slice(0, 88)}…` : r.question, state: 'Research', tone: 'info',
      href: `/app/research/${r.id}`, matterId: r.matter_id, matterTitle: r.matter_title, clientName: r.client_name, at: new Date(r.created_at), done: false });
  }
  for (const m of matters) {
    items.push({ kind: 'matter', id: m.id, title: m.title, state: `${m.practice_area} · ${m.status === 'active' ? `${m.open_tasks} open task(s)` : m.status}`, tone: m.status === 'active' ? 'neutral' : 'ok',
      href: `/app/matters/${m.id}`, matterId: m.id, matterTitle: m.title, clientName: m.client_name, at: new Date(m.updated_at), done: m.status !== 'active' });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function groupBy(items: WorkItem[], key: 'clientName' | 'matterTitle') {
  const groups = new Map<string, WorkItem[]>();
  for (const it of items) {
    const k = it[key] ?? (key === 'clientName' ? 'No client (standalone work)' : 'Not linked to a matter');
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Continue-work items matching an instruction such as "continue my answer in Santos". */
export function matchWork(query: string, items: WorkItem[], limit = 4) {
  const boost = wantsContinue(query) ? 2 : 0;
  return items
    .filter((i) => !i.done)
    .map((i) => ({ item: i, score: scoreText(query, `${i.title} ${i.matterTitle ?? ''} ${i.clientName ?? ''} ${i.state}`) }))
    .filter((x) => x.score >= 1)
    .map((x) => ({ ...x, score: x.score + boost }))
    .sort((a, b) => b.score - a.score || b.item.at.getTime() - a.item.at.getTime())
    .slice(0, limit);
}

export interface Attention {
  deadlines: { id: string; title: string; matter_id: string; matter_title: string; due_at: Date; overdue: boolean }[];
  unverified: { id: string; title: string; matter_title: string }[];
  toApprove: { id: string; title: string; matter_title: string | null; current_version: number }[];
  unfinished: { id: string; title: string; generation_state: string }[];
}

/** "Your attention is needed": confirmed deadlines (overdue or within 7 days), suggestions to verify, drafts to approve or finish. */
export async function attention(ctx: Ctx): Promise<Attention> {
  if (!can(ctx, 'matter_work')) return { deadlines: [], unverified: [], toApprove: [], unfinished: [] };
  const assigned = `exists (select 1 from matter_assignments a where a.matter_id = t.matter_id and a.user_id = $2)`;
  const [deadlines, unverified, drafts] = await Promise.all([
    q<{ id: string; title: string; matter_id: string; matter_title: string; due_at: Date }>(
      `select t.id, t.title, t.matter_id, m.title as matter_title, t.due_at from tasks t join matters m on m.id = t.matter_id
        where t.tenant_id = $1 and ${assigned} and t.status = 'open' and t.verification_status = 'confirmed' and t.due_at is not null
          and t.due_at < now() + interval '7 days' order by t.due_at limit 8`, [ctx.tenantId, ctx.userId]),
    q<{ id: string; title: string; matter_title: string }>(
      `select t.id, t.title, m.title as matter_title from tasks t join matters m on m.id = t.matter_id
        where t.tenant_id = $1 and ${assigned} and t.status = 'open' and t.kind = 'deadline' and t.verification_status = 'unverified'
        order by t.created_at limit 8`, [ctx.tenantId, ctx.userId]),
    can(ctx, 'draft') ? q<{ id: string; title: string; matter_title: string | null; current_version: number; status: string; generation_state: string }>(
      `select d.id, d.title, m.title as matter_title, d.current_version, d.status, d.generation_state from drafts d left join matters m on m.id = d.matter_id
        where d.tenant_id = $1 and d.status <> 'approved'
          and ((d.matter_id is null and d.created_by = $2) or exists (select 1 from matter_assignments a where a.matter_id = d.matter_id and a.user_id = $2))
        order by d.created_at desc limit 30`, [ctx.tenantId, ctx.userId]) : [],
  ]);
  const now = Date.now();
  return {
    deadlines: deadlines.map((d) => ({ ...d, overdue: new Date(d.due_at).getTime() < now })),
    unverified,
    toApprove: can(ctx, 'approve_legal') ? drafts.filter((d) => d.status === 'in_review') : [],
    unfinished: drafts.filter((d) => d.status === 'draft' && d.generation_state !== 'complete').slice(0, 5),
  };
}
