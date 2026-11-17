import { api, body } from '@/lib/api';
import { addSample, listSamples, type SampleInput } from '@/lib/dna';

/** POST /v1/dna/samples — authorized exemplar + purpose/consent → processing state. Lawyer-only. */
export const POST = api(async (ctx, req) => ({ sample_id: await addSample(ctx, await body<SampleInput>(req)), state: 'stored_pending_analysis' }), 201);

export const GET = api(async (ctx) => ({ samples: await listSamples(ctx) }));
