import Link from 'next/link';
import { signUpAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Flash } from '@/components/ui';

export const metadata = { title: 'Create account' };

export default async function SignUp({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div style={{ maxWidth: 560 }}>
      <h1>Create your LEXIA account</h1>
      <p>You will set up your firm workspace after verifying your email. You can invite colleagues later.</p>
      <Flash sp={sp} />
      <form action={signUpAction} className="card">
        <div className="field"><label htmlFor="name">Full name</label><input id="name" name="name" required autoComplete="name" /></div>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" minLength={12} required autoComplete="new-password" />
          <span className="hint">At least 12 characters.</span></div>
        <div className="field"><label htmlFor="firm">Firm or office name</label><input id="firm" name="firm" required autoComplete="organization" />
          <span className="hint">Solo practitioners can use their own name.</span></div>
        <p className="muted">You will review the Terms, Privacy Notice and AI Limitations Disclosure (drafts pending legal review) before using the workspace.</p>
        <Submit>Create account</Submit>
      </form>
      <p>Already registered? <Link href="/signin">Sign in</Link></p>
    </div>
  );
}
