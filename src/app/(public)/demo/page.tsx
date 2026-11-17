import { demoRequestAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Flash } from '@/components/ui';

export const metadata = { title: 'Request a demo' };

export default async function Demo({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Request a pilot demo</h1>
      <p>We are recruiting consenting Philippine solo and small-firm lawyers in civil litigation and general practice, corporate and commercial, and labor and employment practice.</p>
      <Flash sp={sp} />
      <form action={demoRequestAction} className="card">
        <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" required autoComplete="name" /></div>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
        <div className="field"><label htmlFor="firm">Firm (optional)</label><input id="firm" name="firm" autoComplete="organization" /></div>
        <div className="field"><label htmlFor="message">What would you like to see? (optional)</label>
          <textarea id="message" name="message" maxLength={2000} />
          <span className="hint">Please do not include confidential client information.</span></div>
        <Submit>Send request</Submit>
      </form>
    </div>
  );
}
