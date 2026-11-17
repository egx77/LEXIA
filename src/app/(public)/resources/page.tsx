import Link from 'next/link';

export const metadata = { title: 'Resources' };

export default function Resources() {
  return (
    <>
      <h1>Resources</h1>
      <div className="card">
        <h2>Pilot guide</h2>
        <p>The pilot covers three tasks: (A) a verified legal memorandum, (B) a personalized pleading using Lawyer DNA, and (C) a daily action plan — including what to expect when AI is switched off.</p>
        <p className="muted">Pilot credentials are issued by the pilot coordinator. No live support contact has been assigned yet.</p>
      </div>
      <div className="card">
        <h2>Official Philippine sources</h2>
        <p>LEXIA&apos;s design draws on the provenance practices of official sources such as the Supreme Court E-Library and the Official Gazette. Public availability of law does not by itself grant rights to bulk collection or AI processing, so each source is reviewed before ingestion.</p>
      </div>
      <p><Link href="/faq">Read the FAQ →</Link></p>
    </>
  );
}
