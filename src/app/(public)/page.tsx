import Link from 'next/link';

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>From legal question to lawyer-ready work — with the evidence in view.</h1>
        <p className="lead">LEXIA Counsel is a lawyer-supervised workspace for Philippine solo and small-firm practice: source-grounded research,
          drafting in your own professional voice, and everyday matter management. Every proposition shows its source passage, or says plainly that it has none.</p>
        <div className="row" style={{ marginTop: '1.25rem' }}>
          <Link href="/demo" className="btn primary">Request a pilot demo</Link>
          <Link href="/how-it-works" className="btn">See how it works</Link>
        </div>
      </section>

      <section className="grid2" aria-label="Three pilot journeys">
        <div className="card">
          <h2>1 · Legal question → verified memorandum</h2>
          <p>Ask in plain language. LEXIA searches only sources it has rights to use, links each claim to an exact passage, and flags anything it cannot support.</p>
        </div>
        <div className="card">
          <h2>2 · Case file → lawyer-ready pleading</h2>
          <p>Facts keep their labels — allegation, evidence, finding or unverified. Drafts export to editable Word. Nothing is filed or sent automatically.</p>
        </div>
        <div className="card">
          <h2>3 · Matter updates → reviewed daily plan</h2>
          <p>Confirmed deadlines stay separate from suggestions. LEXIA never confirms a date on its own; you verify, then reminders follow.</p>
        </div>
        <div className="card">
          <h2>Built for trust</h2>
          <p>Firm, lawyer and matter isolation; audit trails; opt-in Lawyer DNA; and manual tools that keep working if AI is unavailable or credits run out.</p>
        </div>
      </section>

      <div className="notice info" style={{ marginTop: '1rem' }}>
        <strong>Honest status:</strong> LEXIA is in pilot preparation. Coverage of Philippine law, accuracy and time savings have not yet been measured;
        targets will be set only after a blinded, lawyer-reviewed pilot baseline.
      </div>
    </>
  );
}
