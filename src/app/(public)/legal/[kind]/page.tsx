import { notFound } from 'next/navigation';
import { policy, POLICY_TITLES } from '@/lib/policies';

export const dynamic = 'force-dynamic';

export default async function LegalPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!POLICY_TITLES[kind]) notFound();
  const p = await policy(kind);
  if (!p) notFound();
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>{POLICY_TITLES[kind]}</h1>
      <p className="muted">Version {p.version}</p>
      {p.review_status !== 'approved' && (
        <div className="notice" role="note"><strong>Not published.</strong> This policy is pending responsible legal review. Publication is blocked until review (FR-023); the text below is a placeholder.</div>
      )}
      <div className="card"><p>{p.body}</p></div>
    </div>
  );
}
