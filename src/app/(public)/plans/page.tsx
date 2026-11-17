import Link from 'next/link';
import { listPlans } from '@/lib/policies';

export const metadata = { title: 'Plans' };
export const dynamic = 'force-dynamic';

export default async function Plans() {
  const plans = await listPlans();
  return (
    <>
      <h1>Plans</h1>
      <div className="notice"><strong>Pricing has not been set.</strong> These are placeholder plans for planning and pilot use. Prices, limits, payment processor and tax treatment
        await separate approval; no checkout is available and no payment is taken.</div>
      <div className="grid3">
        {plans.map((p) => (
          <div key={p.code} className="card">
            <h2>{p.name}</h2>
            <p>{p.summary}</p>
            <p className="muted">Price: <strong>not set</strong><br />AI usage allowance: placeholder ({p.placeholder_ai_units} units), not a commitment.</p>
            <Link href="/signup" className="btn">{p.code === 'enterprise' ? 'Contact us' : 'Create account'}</Link>
          </div>
        ))}
      </div>
    </>
  );
}
