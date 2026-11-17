import { api } from '@/lib/api';
import { listDocuments } from '@/lib/matters';

/** GET /v1/matters/{id}/documents — authorized versions; denial reveals no metadata. */
export const GET = api(async (ctx, _req, p) => ({ documents: await listDocuments(ctx, p.id) }));
