import Link from 'next/link';

export const metadata = { title: 'Contact & support' };

export default function Contact() {
  return (
    <div style={{ maxWidth: 680 }}>
      <h1>Contact & support</h1>
      <div className="notice">A support email and escalation contact have not been assigned yet. They must be supplied before the pilot starts.</div>
      <p>For pilot interest, please use the <Link href="/demo">demo request form</Link>.</p>
      <p>If you are a pilot participant and notice a legal citation, confidentiality or data-loss concern, stop using the affected feature and report it immediately to your assigned pilot coordinator.</p>
    </div>
  );
}
