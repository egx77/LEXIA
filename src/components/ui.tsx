import Link from 'next/link';
import type { ClaimStatus } from '@/lib/research';

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const err = typeof sp.error === 'string' ? sp.error : null;
  const ok = typeof sp.ok === 'string' ? sp.ok : null;
  return (
    <>
      {err && <div className="flash error" role="alert"><strong>Could not complete:</strong> {err}</div>}
      {ok && <div className="flash ok" role="status">{ok}</div>}
    </>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

const CLAIM: Record<ClaimStatus, { cls: string; label: string }> = {
  verified: { cls: 'ok', label: '✓ Verified source' },
  needs_checking: { cls: 'warn', label: '! Needs checking' },
  unverified: { cls: 'bad', label: '✕ Unverified — lawyer review required' },
};

export function ClaimBadge({ status }: { status: ClaimStatus }) {
  const c = CLAIM[status];
  return <span className={`badge ${c.cls}`}>{c.label}</span>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function RightsBadge({ state }: { state: string }) {
  const tone = state === 'cleared' ? 'ok' : state === 'unknown' ? 'warn' : 'bad';
  return <Badge tone={tone}>Rights: {state}</Badge>;
}

export function DraftStatus({ status }: { status: string }) {
  if (status === 'approved') return <Badge tone="ok">✓ Lawyer approved</Badge>;
  if (status === 'in_review') return <Badge tone="info">In review</Badge>;
  return <Badge tone="warn">Draft only</Badge>;
}

export function FactBadge({ c }: { c: string }) {
  const map: Record<string, ['ok' | 'warn' | 'bad' | 'info', string]> = {
    evidence: ['ok', 'Evidence'], finding: ['info', 'Finding'], allegation: ['warn', 'Allegation'], unverified: ['bad', 'Unverified'],
  };
  const [tone, label] = map[c] ?? ['neutral', c];
  return <Badge tone={tone as 'ok'}>{label}</Badge>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted" style={{ padding: '.5rem 0' }}>{children}</p>;
}

export function Tabs({ base, current, tabs }: { base: string; current: string; tabs: [string, string][] }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map(([k, label]) => (
        <Link key={k} href={`${base}${base.includes('?') ? '&' : '?'}tab=${k}`} aria-current={current === k ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(new Date(d));
}

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
}

export function Back({ value }: { value: string }) {
  return <input type="hidden" name="back" value={value} />;
}
