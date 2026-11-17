import { api, body } from '@/lib/api';
import { createMatter, listMatters, type NewMatter } from '@/lib/matters';

/** POST /v1/matters — create matter; returns matter_id and version (tenant + role enforced; audited). */
export const POST = api(async (ctx, req) => createMatter(ctx, await body<NewMatter>(req)), 201);

/** GET /v1/matters — assigned matters only. */
export const GET = api(async (ctx) => ({ matters: (await listMatters(ctx)).map(({ id, title, client_name, practice_area, status, version }) => ({ id, title, client_name, practice_area, status, version })) }));
