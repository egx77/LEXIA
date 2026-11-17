import Link from 'next/link';
import { chatAction } from '@/app/actions';
import { Submit } from '@/components/client';
import { Badge, ClaimBadge, Flash, PageHead } from '@/components/ui';
import { aiStatus } from '@/lib/ai/gateway';
import { requirePerm } from '@/lib/authz';
import { chatHistory } from '@/lib/chat';
import { listMatters } from '@/lib/matters';
import { requireCtx } from '@/lib/session';

export const metadata = { title: 'Ask LEXIA' };

export default async function Chat({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  await requirePerm(ctx, 'research');
  const matters = await listMatters(ctx, { status: 'active' });
  const matter = matters.find((m) => m.id === sp.matter);
  const [msgs, st] = await Promise.all([chatHistory(ctx, matter?.id), aiStatus(ctx.tenantId)]);
  return (
    <>
      <PageHead title="Ask LEXIA" sub="Plain-language questions answered only from permitted sources, with citations you can inspect.">
        <form className="row">
          <label htmlFor="matter" className="sr-only">Matter context</label>
          <select id="matter" name="matter" defaultValue={matter?.id ?? ''} style={{ width: 'auto' }}><option value="">No matter context</option>{matters.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
          <button className="btn small">Switch</button>
        </form>
      </PageHead>
      <Flash sp={sp} />
      <p>{st.available ? <Badge tone="ok">AI available · {st.remaining} units</Badge> : <Badge tone="bad">AI paused — answers fall back to keyword search</Badge>} <small className="muted">Manual route: <Link href="/app/library">browse the Legal Library</Link>.</small></p>
      <div className="chat card" aria-live="polite">
        {msgs.length === 0 && <p className="muted">Ask a question such as “Does delay in delivery require a prior demand?”</p>}
        {msgs.map((m, i) => (
          <div key={m.id} id={i === msgs.length - 1 ? 'latest' : undefined} className={`bubble ${m.role}`}>
            <p>{m.content.text}</p>
            {m.content.result?.claims.map((c) => (
              <div key={c.id} style={{ marginTop: '.5rem', fontSize: '.92rem' }}>
                {c.text} <ClaimBadge status={c.status} />
              </div>
            ))}
            {m.content.research_id && <p style={{ marginTop: '.5rem' }}><Link href={`/app/research/${m.content.research_id}`}>Open sources & create memo →</Link></p>}
          </div>
        ))}
      </div>
      <form action={chatAction} className="card">
        {matter && <input type="hidden" name="matter" value={matter.id} />}
        <label htmlFor="text">Your question</label>
        <textarea id="text" name="text" required rows={3} />
        <div style={{ marginTop: '.5rem' }}><Submit pendingText="Searching sources…">Ask</Submit></div>
      </form>
    </>
  );
}
