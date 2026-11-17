import { NextResponse } from 'next/server';
import { DomainError } from '@/lib/errors';
import { readDocumentVersion } from '@/lib/matters';
import { getCtx } from '@/lib/session';

/** Original-file download; authorization re-checked per request (no public object URLs). */
export async function GET(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { versionId } = await params;
  try {
    const f = await readDocumentVersion(ctx, versionId);
    return new NextResponse(Buffer.from(f.bytes), {
      headers: {
        'Content-Type': f.mime,
        'Content-Disposition': `attachment; filename="${f.filename.replace(/["\r\n]/g, '')}"`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    throw e;
  }
}
