import { resetAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Flash } from '@/components/ui';

export const metadata = { title: 'Choose a new password' };

export default async function Reset({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div style={{ maxWidth: 520 }}>
      <h1>Choose a new password</h1>
      <Flash sp={sp} />
      <form action={resetAction} className="card">
        <input type="hidden" name="token" value={sp.token ?? ''} />
        <div className="field"><label htmlFor="password">New password</label><input id="password" name="password" type="password" minLength={12} required autoComplete="new-password" /></div>
        <p className="muted">All existing sessions will be signed out.</p>
        <Submit>Update password</Submit>
      </form>
    </div>
  );
}
