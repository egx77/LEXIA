import { randomUUID } from 'node:crypto';
import { generateDraftAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Back, Flash, PageHead } from '@/components/ui';
import { aiStatus } from '@/lib/ai/gateway';
import { can, requirePerm } from '@/lib/authz';
import { applicableProfiles } from '@/lib/dna';
import { DOC_TYPES } from '@/lib/drafts';
import { listMatters } from '@/lib/matters';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'New draft' };

export default async function NewDraft({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  await requirePerm(ctx, 'draft');
  const [matters, st] = await Promise.all([listMatters(ctx, { status: 'active' }), aiStatus(ctx.tenantId)]);
  const prof = can(ctx, 'dna') ? await applicableProfiles(ctx, 'combined') : null;
  const sel = matters.find((m) => m.id === sp.matter) ?? matters[0];
  return (
    <>
      <PageHead title="Draft a document" sub="FLOW-002 / FLOW-006: choose an authorized matter, document type and drafting mode." />
      <Flash sp={sp} />
      {!st.available && <div className="notice"><strong>AI unavailable.</strong> A manual template with your matter facts will be created; no AI analysis will be generated.</div>}
      <form action={generateDraftAction} className="card" style={{ maxWidth: 900 }}>
        <input type="hidden" name="idem" value={randomUUID()} /><Back value={`/app/drafts/new${sp.matter ? `?matter=${sp.matter}` : ''}`} />
        <div className="row">
          <div className="field"><label htmlFor="matter">Matter</label>
            <select id="matter" name="matter" defaultValue={sel?.id} required>{matters.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></div>
          <div className="field"><label htmlFor="docType">Document type</label>
            <select id="docType" name="docType" defaultValue="complaint">{Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <div className="field"><label htmlFor="title">Title (optional)</label><input id="title" name="title" /></div>
        <div className="field"><label htmlFor="issues">Issues to address (one per line)</label>
          <textarea id="issues" name="issues" rows={4} defaultValue={sel?.issues ?? ''} />
          <span className="hint">Defaults to the matter’s recorded issues. Each issue is researched against permitted sources.</span></div>
        <fieldset>
          <legend>Drafting mode (FR-033)</legend>
          {[['neutral', 'Neutral', 'No personal profile used.'],
            ['writing', 'Writing DNA only', `Voice and format. ${prof?.writing ? `Active profile v${prof.writing.version}.` : 'No active profile — Neutral will be used.'}`],
            ['reasoning', 'Reasoning DNA only', `Analysis order and structure. ${prof?.reasoning ? `Active profile v${prof.reasoning.version}.` : 'No active profile — Neutral will be used.'}`],
            ['combined', 'Combined', 'Both approved profiles, with conflict notes.']]
            .filter(([v]) => v === 'neutral' || can(ctx, 'dna'))
            .map(([v, l, d]) => (
              <label key={v} className="check"><input type="radio" name="mode" value={v} defaultChecked={v === 'neutral'} /><span><strong>{l}</strong> — <span className="muted">{d}</span></span></label>
            ))}
          <p className="muted">A neutral version is always generated alongside for comparison. Preferences never change sources, facts or approval requirements.</p>
        </fieldset>
        <Submit pendingText="Researching issues and drafting…">Generate draft</Submit>
      </form>
    </>
  );
}
