import Link from 'next/link';
import { confirmDeadlineAction, saveActionPlanAction, taskStateAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Back, Badge, Empty, Flash, fmtDateTime, PageHead } from '@/components/ui';
import { can, requirePerm } from '@/lib/authz';
import { requireCtx } from '@/lib/session';
import { formatManila, latestActionPlan, listTasks, suggestPriority, upcomingReminders, type TaskRow } from '@/lib/tasks';

export const metadata = { title: 'Tasks & Calendar' };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  await requirePerm(ctx, 'matter_work');
  const [tasks, reminders, plan] = await Promise.all([listTasks(ctx), upcomingReminders(ctx), latestActionPlan(ctx)]);
  const confirmed = tasks.filter((t) => t.verification_status === 'confirmed');
  const suggested = tasks.filter((t) => t.verification_status === 'unverified');
  const priority = suggestPriority(tasks);
  const isLawyer = can(ctx, 'confirm_deadline');

  return (
    <>
      <PageHead title="Tasks & Calendar" sub="Confirmed dates are kept separate from suggestions. LEXIA never confirms a deadline on its own." />
      <Flash sp={sp} />
      <div className="grid2">
        <section className="card">
          <h2>Confirmed</h2>
          {confirmed.length ? <ul className="list">{confirmed.map((t) => <TaskItem key={t.id} t={t} />)}</ul> : <Empty>No confirmed items.</Empty>}
        </section>
        <section className="card">
          <h2>Suggested — verify before relying on these</h2>
          {suggested.length ? <ul className="list">{suggested.map((t) => (
            <li key={t.id}>
              <Badge tone="warn">Suggested — unverified</Badge> <strong>{t.title}</strong>
              <br /><small>{t.matter_title}{t.evidence_note ? ` · ${t.evidence_note}` : ''}</small>
              {isLawyer ? (
                <form action={confirmDeadlineAction} className="row" style={{ marginTop: '.5rem' }}>
                  <input type="hidden" name="task" value={t.id} /><Back value="/app/tasks" />
                  <div className="field"><label htmlFor={`due-${t.id}`}>Verified date (PHT)</label><input id={`due-${t.id}`} name="due" type="datetime-local" required /></div>
                  <div className="field"><label htmlFor={`ev-${t.id}`}>Basis you verified</label><input id={`ev-${t.id}`} name="evidence" required placeholder="Rule / order / receipt checked" /></div>
                  <Submit className="btn small primary">Confirm</Submit>
                </form>
              ) : <p className="muted">A lawyer must verify and confirm this date.</p>}
              <form action={taskStateAction} style={{ marginTop: '.3rem' }}>
                <input type="hidden" name="task" value={t.id} /><input type="hidden" name="op" value="reject" /><Back value="/app/tasks" />
                <button className="linkish">Reject suggestion</button>
              </form>
            </li>
          ))}</ul> : <Empty>No suggestions waiting.</Empty>}
        </section>
      </div>

      <div className="grid2">
        <form action={saveActionPlanAction} className="card">
          <h2>Daily action plan</h2>
          <p className="muted">Suggested order (deterministic: overdue/near confirmed deadlines first, then items needing verification). Untick anything you do not want; the plan saves only what you select.</p>
          {priority.length ? priority.map((t, i) => (
            <label key={t.id} className="check"><input type="checkbox" name="task" value={t.id} defaultChecked={i < 6} />
              <span>{i + 1}. {t.title} <small className="muted">— {t.matter_title} · {t.verification_status === 'confirmed' ? formatManila(t.due_at) : 'date unverified'}</small></span></label>
          )) : <Empty>No open tasks.</Empty>}
          {priority.length > 0 && <Submit>Save today’s plan</Submit>}
        </form>
        <section className="card">
          <h2>Last saved plan</h2>
          {plan ? <>
            <p className="muted">{plan.plan_date} · saved {fmtDateTime(plan.created_at)}</p>
            <ol>{plan.items.map((i) => <li key={i.task_id}>{i.title} <small className="muted">({i.matter})</small></li>)}</ol>
          </> : <Empty>No plan saved yet.</Empty>}
          <h3>Reminders (deterministic, next 14 days)</h3>
          {reminders.length ? <ul className="list">{reminders.map((r, i) => <li key={i}><strong>{r.remind_on}</strong> — {r.title} <small>({r.matter_title})</small></li>)}</ul> : <Empty>No reminders.</Empty>}
          <p className="muted">Reminders appear here only; email/calendar delivery providers are not yet approved.</p>
        </section>
      </div>
    </>
  );
}

function TaskItem({ t }: { t: TaskRow }) {
  return (
    <li>
      <Badge tone="ok">{t.kind === 'deadline' ? 'Confirmed deadline' : 'Task'}</Badge> <strong>{t.title}</strong>
      <br /><small>{t.matter_title} · Due {formatManila(t.due_at)}{t.verified_by_name ? ` · verified by ${t.verified_by_name}` : ''}</small>
      <form action={taskStateAction} style={{ marginTop: '.3rem' }}>
        <input type="hidden" name="task" value={t.id} /><input type="hidden" name="op" value="done" /><Back value="/app/tasks" />
        <button className="linkish">Mark done</button> · <Link href={`/app/matters/${t.matter_id}?tab=tasks`}>Open matter</Link>
      </form>
    </li>
  );
}
