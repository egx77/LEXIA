import { NextResponse, type NextRequest } from 'next/server';
import { DomainError } from '@/lib/errors';
import { getCtx } from '@/lib/session';
import { exportDraftDocx } from '@/lib/word';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { id } = await params;
  const v = req.nextUrl.searchParams.get('v');
  try {
    const f = await exportDraftDocx(ctx, id, v ? Number(v) : undefined);
    return new NextResponse(Buffer.from(f.bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${f.filename.replace(/["\r\n]/g, '')}"`,
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    throw e;
  }
}
