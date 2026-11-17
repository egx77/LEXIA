import { createMatterAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Flash, PageHead } from '@/components/ui';
import { requirePerm } from '@/lib/authz';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'New matter' };

export default async function NewMatter({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  await requirePerm(ctx, 'create_matter');
  return (
    <>
      <PageHead title="New matter" sub="You will be assigned automatically. Add colleagues from the matter’s Team tab." />
      <Flash sp={sp} />
      <form action={createMatterAction} className="card" style={{ maxWidth: 820 }}>
        <div className="row">
          <div className="field"><label htmlFor="client">Client name</label><input id="client" name="client" required /></div>
          <div className="field" style={{ flex: '0 1 220px' }}><label htmlFor="clientKind">Client type</label>
            <select id="clientKind" name="clientKind"><option value="individual">Individual</option><option value="organization">Organization</option></select></div>
        </div>
        <div className="field"><label htmlFor="title">Matter title</label><input id="title" name="title" required placeholder="e.g. Client v. Opposing Party" /></div>
        <div className="row">
          <div className="field"><label htmlFor="practice">Practice area</label>
            <select id="practice" name="practice"><option>Civil Litigation</option><option>General Practice</option><option>Corporate and Commercial</option><option>Labor and Employment</option><option>Other</option></select></div>
          <div className="field"><label htmlFor="opposing">Opposing party (optional)</label><input id="opposing" name="opposing" /></div>
        </div>
        <div className="field"><label htmlFor="issues">Legal issues (one per line)</label>
          <textarea id="issues" name="issues" rows={4} placeholder="Whether …" />
          <span className="hint">Used to research and structure drafts. You can edit them later.</span></div>
        <Submit>Create matter</Submit>
      </form>
    </>
  );
}
