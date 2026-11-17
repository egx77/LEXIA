export const metadata = { title: 'FAQ' };

const QA: [string, string][] = [
  ['Does LEXIA cover all of Philippine law?', 'No. LEXIA searches only sources whose rights for indexing, AI processing and display have been recorded. Coverage is shown in the Legal Library and is not complete.'],
  ['Does “Verified source” mean the law is still in force?', 'No. It means the quoted text exactly matches an authorized source passage that is relevant to the issue. Amendment and negative-treatment status is shown separately and is often “not verified”.'],
  ['Will LEXIA file or send documents?', 'Never. LEXIA prepares drafts, tasks and suggested communications. Filing, serving, sending, paying and accepting clients are always done by you, outside LEXIA.'],
  ['What is Lawyer DNA?', 'An optional, consented profile of observable writing and reasoning preferences learned from samples you authorize. You review and edit every trait, and it never overrides law or evidence.'],
  ['Is my client data used to train shared models?', 'No. Confidential material is not used to train shared models. Profiles are per-lawyer and isolated.'],
  ['What happens if AI is down or credits run out?', 'Your files, matters, tasks, sources and drafts remain available; you can edit and export to Word. New AI generation pauses and says so.'],
  ['Does it work offline?', 'The app is online-first. Confidential matter data is not stored on your device. Only public, static files may be cached.'],
  ['How much does it cost?', 'Pricing has not been set. Plans shown are placeholders.'],
];

export default function Faq() {
  return (
    <>
      <h1>Frequently asked questions</h1>
      {QA.map(([q, a]) => (
        <details key={q} className="card flat">
          <summary><strong>{q}</strong></summary>
          <p style={{ marginTop: '.5rem' }}>{a}</p>
        </details>
      ))}
    </>
  );
}
