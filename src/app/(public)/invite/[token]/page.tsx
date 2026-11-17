import { acceptInviteAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Flash } from '@/components/ui';
import { getInvitation } from '@/lib/accounts';
import { ROLE_LABEL } from '@/lib/authz';
import { one } from '@/lib/db';

export const metadata = { title: 'Join a firm' };

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const inv = await getInvitation(decodeURIComponent(token));
  if (!inv) return <div><h1>Invitation unavailable</h1><p>This invitation is invalid, already used or expired. Ask your firm administrator for a new one.</p></div>;
  const existing = await one(`select 1 from users where lower(email) = $1`, [inv.email]);
  return (
    <div style={{ maxWidth: 560 }}>
      <h1>Join {inv.tenant_name}</h1>
      <p>You were invited as <strong>{inv.roles.map((r) => ROLE_LABEL[r]).join(', ')}</strong> using <code>{inv.email}</code>.</p>
      <Flash sp={sp} />
      <form action={acceptInviteAction} className="card">
        <input type="hidden" name="token" value={decodeURIComponent(token)} />
        {!existing && <div className="field"><label htmlFor="name">Full name</label><input id="name" name="name" required autoComplete="name" /></div>}
        <div className="field"><label htmlFor="password">{existing ? 'Your existing LEXIA password' : 'Choose a password (12+ characters)'}</label>
          <input id="password" name="password" type="password" required minLength={existing ? 1 : 12} autoComplete={existing ? 'current-password' : 'new-password'} /></div>
        <Submit>Accept invitation</Submit>
      </form>
    </div>
  );
}
