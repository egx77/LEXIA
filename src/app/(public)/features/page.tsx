export const metadata = { title: 'Features' };

const FEATURES: [string, string, string][] = [
  ['Philippine Legal Truth Engine', 'Hybrid keyword and meaning search across rights-cleared sources only. Each claim links to the exact passage, version and last-checked date. Status warnings appear when amendment or treatment has not been verified.', 'A citation is evidence of a passage, not proof that the authority remains good law.'],
  ['Lawyer DNA — Writing & Reasoning', 'Separately opt in to Writing DNA (tone, headings, prayers, citation presentation) and Reasoning DNA (issue order, procedural checks, counterarguments, risk framing). Review and edit every trait; compare personalized and neutral drafts.', 'Preferences never override law, evidence or your approval. Revoke anytime.'],
  ['Matter Intelligence', 'Client and matter records, immutable document versions, a classified fact chronology and tasks — scoped to the people assigned.', 'Different matters never share context.'],
  ['Supervised AI Legal Team', 'Bounded research, drafting and checking steps with run logs, usage metering and cancellation. Partial work is kept if a step fails.', 'No external action — filing, serving, sending or paying — is possible from LEXIA.'],
  ['Conversational workspace', 'Ask questions in plain language and get cited answers with links to create a memo or open the matter.', 'AI and credit status is always shown, with the manual route.'],
  ['Trust by design', 'Deny-by-default access, append-only audit, rights registry for every source, and no confidential data cached offline.', 'Manual records, editor and Word export keep working during AI outages.'],
];

export default function Features() {
  return (
    <>
      <h1>Features</h1>
      <p className="muted">Proposed MVP capabilities for the Counsel workspace. Phase 2+ items (Devil&apos;s Advocate depth, citation graph, proactive copilot) are not included.</p>
      <div className="grid2" style={{ marginTop: '1rem' }}>
        {FEATURES.map(([t, d, g]) => (
          <div key={t} className="card feature">
            <h3>{t}</h3>
            <p>{d}</p>
            <p className="muted"><em>{g}</em></p>
          </div>
        ))}
      </div>
    </>
  );
}
