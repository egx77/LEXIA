import Link from 'next/link';
import { PageHead } from '@/components/ui';

export const metadata = { title: 'Help' };

export default function Help() {
  return (
    <>
      <PageHead title="Help & pilot guide" sub="Draft pilot tasks for consenting lawyers using fictional matters." />
      <div className="grid2">
        <div className="card">
          <h2>Task A — verified legal memorandum</h2>
          <ol>
            <li>Open the fictional matter “Marina Santos v. Bayani Trading Corp.” and choose <strong>Research</strong>.</li>
            <li>Enter a question; keep the permitted source scope.</li>
            <li>Inspect the issue outline and each passage; note “Needs checking” and stale-source warnings.</li>
            <li>Create a memo draft, review citations and facts, approve the version and export Word.</li>
          </ol>
          <p className="muted">Expected: a reviewable document; unsupported propositions are clearly flagged.</p>
        </div>
        <div className="card">
          <h2>Task B — personalized pleading</h2>
          <ol>
            <li>Open <Link href="/app/dna">Lawyer DNA</Link>; read the notice; consent separately to Writing and/or Reasoning DNA.</li>
            <li>Add only authorized samples; review and approve each profile.</li>
            <li>Draft a pleading in <strong>Combined</strong> mode; use “Compare with Neutral”.</li>
            <li>Edit, then accept or reject proposed profile refinements; approve and export.</li>
          </ol>
          <p className="muted">Expected: voice and structure may feel familiar; legal correctness and your approval remain mandatory.</p>
        </div>
        <div className="card">
          <h2>Task C — daily action plan</h2>
          <ol>
            <li>Open <Link href="/app/tasks">Tasks & Calendar</Link>; compare confirmed and suggested items.</li>
            <li>Inspect a suggestion’s basis; confirm the date yourself or reject it.</li>
            <li>Save the plan. Then (admin) set “Provider outage” under Account &amp; Usage and confirm manual tools still work.</li>
          </ol>
        </div>
        <div className="card">
          <h2>When something goes wrong</h2>
          <table><tbody>
            <tr><th>No source found</th><td>LEXIA does not invent authority. Use manual search; the claim stays unverified.</td></tr>
            <tr><th>AI quota exhausted</th><td>Drafts, notes, files and Word export are kept; generation pauses.</td></tr>
            <tr><th>No matter permission</th><td>Access is denied without revealing client details.</td></tr>
            <tr><th>DNA consent withdrawn</th><td>The profile and samples stop being used immediately.</td></tr>
            <tr><th>Offline</th><td>Confidential matter data requires an online connection.</td></tr>
            <tr><th>Unverified deadline</th><td>Not shown as confirmed until a lawyer verifies it.</td></tr>
          </tbody></table>
          <p className="muted">Report any citation, confidentiality or data-loss concern immediately to your pilot coordinator (contact to be assigned before the pilot).</p>
        </div>
      </div>
    </>
  );
}
