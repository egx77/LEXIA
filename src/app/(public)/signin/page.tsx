import Link from 'next/link';
import { signInAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Flash } from '@/components/ui';
import { FIXTURE_PASSWORD, FIXTURE_USERS } from '@/lib/fixtures';

export const metadata = { title: 'Sign in' };

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const showFixtures = process.env.LEXIA_ENV !== 'production' && process.env.LEXIA_SEED_FIXTURES !== 'false';
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div>
        <h1>Sign in to LEXIA Counsel</h1>
        <Flash sp={sp} />
        <form action={signInAction} className="card">
          <input type="hidden" name="next" value={sp.next ?? '/app'} />
          <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="username" /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password" /></div>
          <Submit>Sign in</Submit>
          <p style={{ marginTop: '1rem' }}><Link href="/forgot">Forgot password?</Link> · <Link href="/signup">Create an account</Link></p>
        </form>
        <p className="muted">Multi-factor authentication and session policy are pending security decision DEV-205.</p>
      </div>
      {showFixtures && (
        <div className="card">
          <h2>Synthetic test accounts</h2>
          <p className="muted">Development/pilot-staging only. All people, firms and matters are fictional (FD 07 §6). Password for every account: <code>{FIXTURE_PASSWORD}</code></p>
          <ul className="list">
            {FIXTURE_USERS.map((u) => (
              <li key={u.email}><code>{u.email}</code><br /><small>{u.note}</small></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
