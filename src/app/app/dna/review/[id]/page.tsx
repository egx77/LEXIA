import { redirect } from 'next/navigation';
import { submitBlindReviewAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Flash, PageHead } from '@/components/ui';
import { DomainError } from '@/lib/errors';
import { getReview } from '@/lib/pilot';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'Blind review' };

type Version = { kind: string; text: string }[];

function Doc({ label, blocks }: { label: string; blocks: Version }) {
  return (
    <section className="card" aria-labelledby={`v-${label}`}>
      <h2 id={`v-${label}`}>Version {label}</h2>
      {blocks.map((b, i) => (b.kind === 'heading' || b.kind === 'title' || b.kind === 'caption'
        ? <h3 key={i}>{b.text}</h3>
        : <p key={i}>{b.text}</p>))}
    </section>
  );
}

function Choice({ name, legend, options }: { name: string; legend: string; options: [string, string][] }) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {options.map(([v, l]) => (
        <label key={v} style={{ display: 'block' }}><input type="radio" name={name} value={v} required /> {l}</label>
      ))}
    </fieldset>
  );
}

export default async function BlindReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const r = await getReview(ctx, id).catch((e) => { if (e instanceof DomainError) redirect('/app/dna?tab=blind'); throw e; });
  if (r.completed) redirect('/app/dna?tab=blind');
  const ab: [string, string][] = [['a', 'Version A'], ['b', 'Version B'], ['unsure', 'I can’t tell']];

  return (
    <>
      <PageHead title="Blind review" sub={`${r.title} — two versions, unlabeled, in random order. Read both, then answer below.`} />
      <Flash sp={sp} />
      <div className="grid2">
        <Doc label="A" blocks={r.a} />
        <Doc label="B" blocks={r.b} />
      </div>
      <form action={submitBlindReviewAction} className="card">
        <input type="hidden" name="id" value={r.id} />
        <Choice name="voice" legend="1. Which version reads more like your own writing?" options={ab} />
        <Choice name="approach" legend="2. Which version better follows how you usually analyse and argue a case?" options={ab} />
        <Choice name="legal" legend="3. Did you notice a legal error or unsupported statement?" options={[['none', 'No'], ['a', 'Yes, in A'], ['b', 'Yes, in B'], ['both', 'Yes, in both']]} />
        <Choice name="effort" legend="4. How much would you edit the version closer to your style before filing?" options={[['none', 'None'], ['light', 'Light edits'], ['moderate', 'Moderate rewrite'], ['heavy', 'Heavy rewrite']]} />
        <div className="field"><label htmlFor="comment">Comment (optional)</label><textarea id="comment" name="comment" rows={3} maxLength={2000} /></div>
        <label style={{ display: 'block', marginBottom: '.75rem' }}>
          <input type="checkbox" name="consent" value="yes" /> I consent to these answers being used, without my name, to evaluate Lawyer DNA in the pilot.
        </label>
        <p className="muted"><small>Answers cannot be changed after submitting. Which version used your Lawyer DNA is shown only afterwards.</small></p>
        <Submit>Submit review</Submit>
      </form>
    </>
  );
}
