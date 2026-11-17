export const metadata = { title: 'How it works' };

export default function HowItWorks() {
  const steps = [
    ['Authorize', 'Every request checks your firm, role, matter assignment, source scope and Lawyer DNA consent before anything is retrieved.'],
    ['Separate facts from questions', 'Statements you provide are treated as unverified allegations; facts recorded in a matter keep their classification.'],
    ['Retrieve permitted sources', 'Keyword and meaning search run only over passages whose rights allow indexing, AI processing and display.'],
    ['Draft with references', 'Each material proposition quotes an exact passage. Where nothing supports it, the draft says “No authorized source found.”'],
    ['Apply your style — optionally', 'Writing DNA shapes voice and format; Reasoning DNA shapes analysis order. Controlling law and evidence always win.'],
    ['Check independently', 'A separate checker re-resolves every citation, compares quotes, checks freshness, and fails closed.'],
    ['You review and approve', 'Edit in a three-pane editor with sources beside the text. Approval binds to the exact version; any later edit requires re-approval.'],
    ['Export to Word', 'Download an editable .docx stamped “Draft only” or “Lawyer approved”, with a source annex. LEXIA files nothing.'],
  ];
  return (
    <>
      <h1>How it works</h1>
      <ol className="list" style={{ listStyle: 'decimal', paddingLeft: '1.5rem' }}>
        {steps.map(([t, d]) => <li key={t}><strong>{t}.</strong> {d}</li>)}
      </ol>
      <div className="notice info"><strong>If AI is unavailable:</strong> matters, documents, tasks, source browsing, keyword search, the editor and Word export continue to work. New AI generation pauses with a clear message.</div>
    </>
  );
}
