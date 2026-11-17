import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signOutAction, switchTenantAction, textSizeAction } from '@/app/actions';
import { OnlineStatus } from '@/components/client';
import { NavLinks, type NavItem } from '@/components/nav';
import { Badge } from '@/components/ui';
import { listMyTenants } from '@/lib/accounts';
import { aiStatus } from '@/lib/ai/gateway';
import { can, ROLE_LABEL } from '@/lib/authz';
import { pendingAcceptances } from '@/lib/policies';
import { requireCtx } from '@/lib/session';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  if ((await pendingAcceptances(ctx.userId)).length) redirect('/onboarding');
  const [st, tenants] = await Promise.all([aiStatus(ctx.tenantId), listMyTenants(ctx.userId)]);
  const large = (await cookies()).get('lexia_text')?.value === 'large';

  // Task-oriented navigation: the Work Desk first; individual tools stay one level down. Filtered by role
  // (deny-by-default UI mirrors server enforcement).
  const items: NavItem[] = [{ href: '/app', label: 'Work Desk' }];
  const worker = can(ctx, 'matter_work') || can(ctx, 'research');
  if (worker) items.push({ href: '/app/continue', label: 'Continue Work' }, { href: '/app/start', label: 'Start New Work' });
  if (can(ctx, 'matter_work')) items.push({ href: '/app/matters', label: 'Cases & Matters', group: 'My tools' });
  if (can(ctx, 'matter_work')) items.push({ href: '/app/tasks', label: 'Schedule & Tasks', group: 'My tools' });
  if (can(ctx, 'draft')) items.push({ href: '/app/drafts', label: 'Documents', group: 'My tools' });
  if (can(ctx, 'research')) items.push({ href: '/app/research', label: 'Legal Research', group: 'My tools' }, { href: '/app/chat', label: 'Ask LEXIA', group: 'My tools' });
  if (can(ctx, 'research') || can(ctx, 'manage_core_sources')) items.push({ href: '/app/library', label: 'Legal Library', group: 'My tools' });
  if (can(ctx, 'dna')) items.push({ href: '/app/dna', label: 'Lawyer DNA', group: 'My tools' });
  if (can(ctx, 'manage_members')) items.push({ href: '/app/team', label: 'Team', group: 'Firm' });
  if (can(ctx, 'view_billing')) items.push({ href: '/app/account', label: 'Account & Usage', group: can(ctx, 'manage_members') ? 'Firm' : 'Firm' });
  items.push({ href: '/app/help', label: 'Help', group: 'Support' });

  return (
    <div className="shell">
      <aside className="sidenav" aria-label="Counsel navigation">
        <Link href="/app" className="brand">LEXIA<span>Counsel</span></Link>
        <nav><NavLinks items={items} /></nav>
      </aside>
      <div className="main">
        <div className="mobile-nav">
          <details>
            <summary>☰ Menu — LEXIA Counsel</summary>
            <nav aria-label="Counsel navigation (mobile)"><NavLinks items={items} className="m" /></nav>
          </details>
        </div>
        <header className="topbar">
          <div className="who">
            <strong>{ctx.tenantName}</strong>
            {tenants.length > 1 && (
              <form action={switchTenantAction} className="row" style={{ gap: '.3rem' }}>
                <label htmlFor="tenant" className="sr-only">Switch firm</label>
                <select id="tenant" name="tenant" defaultValue={ctx.tenantId} style={{ minHeight: 36, width: 'auto' }}>
                  {tenants.map((t) => <option key={t.tenant_id} value={t.tenant_id}>{t.name}</option>)}
                </select>
                <button className="btn small">Switch</button>
              </form>
            )}
            {st.available
              ? <Badge tone="ok">AI available · {st.remaining} units left</Badge>
              : <Badge tone="bad">AI paused — manual tools available</Badge>}
            {st.simulation !== 'none' && <Badge tone="warn">Test simulation: {st.simulation}</Badge>}
          </div>
          <div className="who">
            <span>{ctx.name} <small>({ctx.roles.map((r) => ROLE_LABEL[r]).join(', ')})</small></span>
            <form action={textSizeAction}>
              <input type="hidden" name="back" value="/app" />
              <input type="hidden" name="size" value={large ? 'normal' : 'large'} />
              <button className="btn small" title="Change text size">{large ? 'A− Normal text' : 'A+ Larger text'}</button>
            </form>
            <form action={signOutAction}><button className="btn small">Sign out</button></form>
          </div>
        </header>
        <main id="main" className="content">
          <OnlineStatus />
          {!st.available && (
            <div className="notice" role="status"><strong>AI drafting paused; your files and edits are saved.</strong> {st.reason} Matters, documents, tasks, source browsing, keyword search, editing and Word export remain available.</div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
