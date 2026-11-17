import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSession, SESSION_HOURS } from './accounts';
import type { Ctx } from './authz';
import { DomainError } from './errors';

export const SESSION_COOKIE = 'lexia_session';

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function getCtx(): Promise<Ctx | null> {
  return resolveSession(await sessionToken());
}

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect('/signin');
  return ctx;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_HOURS * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Only allow same-site relative redirects (no open redirects). */
export function safePath(p: unknown, fallback = '/app'): string {
  const s = typeof p === 'string' ? p : '';
  return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s : fallback;
}

export function withMsg(path: string, kind: 'error' | 'ok', msg: string) {
  const [base, hash] = path.split('#');
  const u = new URL(base, 'http://x');
  u.searchParams.delete('error');
  u.searchParams.delete('ok');
  u.searchParams.set(kind, msg);
  return u.pathname + u.search + (hash ? '#' + hash : '');
}

/** Run a domain operation; DomainErrors become a safe flash message on the originating page. */
export async function attempt<T>(fn: () => Promise<T>, back: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DomainError) redirect(withMsg(back, 'error', e.message));
    throw e;
  }
}
