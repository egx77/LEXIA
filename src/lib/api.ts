import 'server-only';
import { NextResponse } from 'next/server';
import type { Ctx } from './authz';
import { DomainError } from './errors';
import { getCtx } from './session';

/**
 * FD 05 §3 logical API contracts. Session-cookie authentication (DEV-205 pending: token/OAuth design).
 * Error shape: { error: <code>, message: <safe text> }.
 */
export function api(handler: (ctx: Ctx, req: Request, params: Record<string, string>) => Promise<unknown>, status = 200) {
  return async (req: Request, { params }: { params: Promise<Record<string, string>> }) => {
    const ctx = await getCtx();
    if (!ctx) return NextResponse.json({ error: 'unauthenticated', message: 'Sign in required.' }, { status: 401 });
    try {
      const out = await handler(ctx, req, await params);
      return NextResponse.json(out ?? { ok: true }, { status, headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      if (e instanceof DomainError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
      if (e instanceof SyntaxError) return NextResponse.json({ error: 'invalid_input', message: 'Malformed JSON body.' }, { status: 400 });
      console.error('[lexia-api]', e instanceof Error ? e.message : 'error'); // no request bodies in logs
      return NextResponse.json({ error: 'internal', message: 'Unexpected error.' }, { status: 500 });
    }
  };
}

export async function body<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}
