import { NextResponse } from 'next/server';
import { DomainError } from '@/lib/errors';
import { exportMatter } from '@/lib/matters';
import { getCtx } from '@/lib/session';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  try {
    const data = await exportMatter(ctx, id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="matter-${id.slice(0, 8)}.json"`, 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    throw e;
  }
}
