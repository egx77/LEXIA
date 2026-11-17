import Link from 'next/link';
import { redirect } from 'next/navigation';
import { onboardingAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Flash } from '@/components/ui';
import { entitlement, listPlans, pendingAcceptances, POLICY_TITLES } from '@/lib/policies';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'Set up your workspace' };

export default async function Onboarding({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const pending = await pendingAcceptances(ctx.userId);
  if (!pending.length && !sp.error) redirect('/app');
  const plans = await listPlans();
  const ent = await entitlement(ctx.tenantId);
  const admin = ctx.roles.includes('firm_admin');
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>Set up {ctx.tenantName}</h1>
      <Flash sp={sp} />
      <form action={onboardingAction}>
        <fieldset className="card">
          <legend>1 · Review policies</legend>
          <div className="notice"><strong>Drafts pending legal review.</strong> Your acceptance of each version is recorded. You will be asked again when reviewed versions are published.</div>
          {pending.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" name="policy" value={p.id} required />
              <span>I have read the <Link href={`/legal/${p.kind}`} target="_blank">{POLICY_TITLES[p.kind]}</Link> (version {p.version}).</span>
            </label>
          ))}
        </fieldset>
        {admin && (
          <fieldset className="card">
            <legend>2 · Choose a placeholder plan</legend>
            <p className="muted">Pricing is not set and paid activation waits for an approved billing provider. No payment will be taken.</p>
            {plans.map((p) => (
              <label key={p.code} className="check">
                <input type="radio" name="plan" value={p.code} defaultChecked={(ent?.plan_code ?? 'pilot') === p.code} />
                <span><strong>{p.name}</strong> — {p.summary}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="card flat">
          <p>Next: invite colleagues and assign roles under <strong>Team</strong>, then create your first matter. Lawyer DNA is separate and optional — nothing about your writing is analyzed unless you opt in.</p>
          <Submit>Continue to Counsel</Submit>
        </div>
      </form>
    </div>
  );
}
