import Link from 'next/link';
import { forgotAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Flash } from '@/components/ui';

export const metadata = { title: 'Reset password' };

export default async function Forgot({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div style={{ maxWidth: 520 }}>
      <h1>Reset your password</h1>
      <Flash sp={sp} />
      {sp.dev && <div className="notice info"><strong>Development reset link:</strong> <Link href={`/reset?token=${encodeURIComponent(sp.dev)}`}>Choose a new password</Link></div>}
      <form action={forgotAction} className="card">
        <div className="field"><label htmlFor="email">Account email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
        <Submit>Request reset link</Submit>
      </form>
    </div>
  );
}
