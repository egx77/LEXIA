import Link from 'next/link';
import { getCtx } from '@/lib/session';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  return (
    <>
      {process.env.LEXIA_ENV !== 'production' && (
        <div className="env-banner" role="note">Pilot prototype · synthetic test data only · not a launched service · no payments are processed</div>
      )}
      <header className="site-header">
        <div className="inner">
          <Link href="/" className="brand">LEXIA<span>Legal Intelligence Assistant</span></Link>
          <nav className="site-nav" aria-label="Main">
            <Link href="/features">Features</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/plans">Plans</Link>
            <Link href="/faq">FAQ</Link>
            <Link href="/demo">Request demo</Link>
            {ctx ? <Link href="/app" className="btn primary small">Open Counsel</Link> : <>
              <Link href="/signin">Sign in</Link>
              <Link href="/signup" className="btn primary small">Create account</Link>
            </>}
          </nav>
        </div>
      </header>
      <main id="main" className="page">{children}</main>
      <footer className="site-footer">
        <div className="inner">
          <nav aria-label="Policies and support">
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/ai_disclosure">AI limitations</Link>
            <Link href="/legal/subscription">Subscription policy</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/contact">Contact & support</Link>
          </nav>
          <p>LEXIA assists qualified lawyers. It does not replace lawyers or judicial decision-makers, does not give final legal advice, and does not file, serve or send anything on your behalf.
            Legal source coverage is limited to rights-cleared sources and is not complete.</p>
        </div>
      </footer>
    </>
  );
}
