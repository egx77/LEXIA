import Link from 'next/link';
import { inviteAction, memberAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Badge, Flash, PageHead } from '@/components/ui';
import { listMembers } from '@/lib/accounts';
import { requirePerm, ROLE_LABEL, ROLES } from '@/lib/authz';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'Team' };

export default async function Team({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  await requirePerm(ctx, 'manage_members');
  const members = await listMembers(ctx);
  const assignable = ROLES.filter((r) => r !== 'qa_editor');
  return (
    <>
      <PageHead title="Team" sub="Least-privilege roles. Matter access is granted separately on each matter." />
      <Flash sp={sp} />
      {sp.invite && <div className="notice info"><strong>Development invitation link</strong> (no email provider approved): <Link href={`/invite/${encodeURIComponent(sp.invite)}`}>/invite/…</Link> — share it with the invitee securely.</div>}
      <div className="grid2">
        <section className="card">
          <h2>Members</h2>
          <ul className="list">{members.map((m) => (
            <li key={m.user_id}>
              <strong>{m.name}</strong> <small>{m.email}</small> {m.status !== 'active' && <Badge tone="bad">revoked</Badge>}
              {m.status === 'active' && (
                <form action={memberAction} style={{ marginTop: '.4rem' }}>
                  <input type="hidden" name="user" value={m.user_id} />
                  <div>{assignable.map((r) => (
                    <label key={r} className="check" style={{ display: 'inline-flex', marginRight: '.9rem' }}><input type="checkbox" name="role" value={r} defaultChecked={m.roles.includes(r)} /> <span>{ROLE_LABEL[r]}</span></label>
                  ))}</div>
                  <div className="row">
                    <button className="btn small" name="op" value="roles">Save roles</button>
                    {m.user_id !== ctx.userId && <button className="btn small danger" name="op" value="revoke">Revoke access</button>}
                  </div>
                </form>
              )}
            </li>
          ))}</ul>
        </section>
        <form action={inviteAction} className="card">
          <h2>Invite a member</h2>
          <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required /></div>
          <fieldset><legend>Roles</legend>
            {assignable.map((r) => <label key={r} className="check"><input type="checkbox" name="role" value={r} defaultChecked={r === 'legal_assistant'} /><span>{ROLE_LABEL[r]}</span></label>)}
          </fieldset>
          <p className="muted">Billing/admin staff cannot see privileged matter content. Legal assistants cannot give final approval or confirm deadlines.</p>
          <Submit>Create invitation</Submit>
        </form>
      </div>
    </>
  );
}
