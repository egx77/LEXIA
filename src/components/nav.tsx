'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem { href: string; label: string; group?: string }

export function NavLinks({ items, className = 'nav' }: { items: NavItem[]; className?: string }) {
  const path = usePathname();
  let lastGroup: string | undefined;
  return (
    <>
      {items.map((it) => {
        const active = it.href === '/app' ? path === '/app' : path.startsWith(it.href);
        const header = it.group && it.group !== lastGroup ? <div className="group" key={`g-${it.group}`}>{it.group}</div> : null;
        lastGroup = it.group;
        return [header, <Link key={it.href} href={it.href} className={className} aria-current={active ? 'page' : undefined}>{it.label}</Link>];
      })}
    </>
  );
}
