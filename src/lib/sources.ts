import { audit } from './audit';
import { accessibleMatterIds, assertMatterAccess, can, requirePerm, type Ctx } from './authz';
import { sha256 } from './crypto';
import { one, q, tx, type Queryable } from './db';
import { embed, EMBEDDING_MODEL, STOP, toPgVector } from './embedding';
import { DomainError } from './errors';
import { looksLikeInstruction } from './ai/gateway';

/**
 * Legal knowledge services — FR-006 registry, FR-007 ingestion, FR-008 search, FR-009 freshness.
 * DEV-101: every source carries explicit per-use permissions; unknown/restricted rights block automation.
 * Four library scopes (FS-045): core (shared, rights-cleared), firm, personal lawyer, matter.
 */

export const USES = ['ingest', 'index', 'ai_processing', 'display', 'redistribute'] as const;
export type Use = (typeof USES)[number];
export type RightsState = 'unknown' | 'cleared' | 'restricted' | 'suspended';
export type Scope = 'core' | 'firm' | 'personal' | 'matter';
export const STALE_AFTER_DAYS = 180; // placeholder review cadence; pending owner/legal QA decision

export interface SourceRow {
  id: string; scope: Scope; tenant_id: string | null; owner_user_id: string | null; matter_id: string | null;
  title: string; authority: string; source_type: string; court: string | null; url: string | null; access_method: string;
  coverage: string | null; owner: string | null; restrictions: string | null; rights_state: RightsState; permitted_uses: Use[];
  last_checked_at: Date | null; is_test_fixture: boolean; created_at: Date;
}

// ---- Scope filter (applied BEFORE ranking: FD 04 §4, TC-008) ----

async function scopeClause(ctx: Ctx, alias: string, startIdx: number, t?: Queryable) {
  const matterIds = await accessibleMatterIds(ctx, t);
  const sql = `(${alias}.scope = 'core'
     or (${alias}.scope = 'firm' and ${alias}.tenant_id = $${startIdx})
     or (${alias}.scope = 'personal' and ${alias}.tenant_id = $${startIdx} and ${alias}.owner_user_id = $${startIdx + 1})
     or (${alias}.scope = 'matter' and ${alias}.tenant_id = $${startIdx} and ${alias}.matter_id = any($${startIdx + 2}::uuid[])))`;
  return { sql, params: [ctx.tenantId, ctx.userId, matterIds] };
}

function canManageSource(ctx: Ctx, s: Pick<SourceRow, 'scope' | 'tenant_id' | 'owner_user_id'>) {
  if (s.scope === 'core') return can(ctx, 'manage_core_sources');
  if (s.tenant_id !== ctx.tenantId) return false;
  if (s.scope === 'personal') return s.owner_user_id === ctx.userId;
  return can(ctx, 'manage_firm_sources');
}

// ---- Registry (FR-006) ----

export interface RegisterSourceInput {
  scope: Scope; matterId?: string; title: string; authority: string; sourceType: string; court?: string; url?: string;
  accessMethod?: string; coverage?: string; owner?: string; restrictions?: string;
  rightsState: RightsState; permittedUses: string[]; isTestFixture?: boolean; rightsAttested?: boolean;
}

export async function registerSource(ctx: Ctx, input: RegisterSourceInput) {
  if (input.scope === 'core') await requirePerm(ctx, 'manage_core_sources');
  else if (input.scope === 'personal') await requirePerm(ctx, 'research');
  else await requirePerm(ctx, 'manage_firm_sources');
  if (!input.title.trim() || !input.authority.trim()) throw new DomainError('invalid_input', 'Title and authority are required.');
  const uses = input.permittedUses.filter((u): u is Use => (USES as readonly string[]).includes(u));
  if (input.scope !== 'core' && input.rightsState === 'cleared' && !input.rightsAttested) {
    throw new DomainError('rights_blocked', 'Confirm you hold the rights recorded for this reference upload.');
  }
  if (input.scope === 'matter') {
    if (!input.matterId) throw new DomainError('invalid_input', 'Choose a matter for a matter-library source.');
    await assertMatterAccess(ctx, input.matterId);
  }
  const r = (await one<{ id: string }>(
    `insert into legal_sources(scope, tenant_id, owner_user_id, matter_id, title, authority, source_type, court, url, access_method,
       coverage, owner, restrictions, rights_state, permitted_uses, is_test_fixture, created_by, last_checked_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now()) returning id`,
    [input.scope, input.scope === 'core' ? null : ctx.tenantId, input.scope === 'personal' ? ctx.userId : null,
      input.scope === 'matter' ? input.matterId : null, input.title.trim(), input.authority.trim(), input.sourceType,
      input.court?.trim() || null, input.url?.trim() || null, input.accessMethod?.trim() || 'manual', input.coverage?.trim() || null,
      input.owner?.trim() || null, input.restrictions?.trim() || null, input.rightsState, uses, !!input.isTestFixture, ctx.userId]))!;
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'source.register', targetType: 'source', targetId: r.id,
    meta: { scope: input.scope, rights_state: input.rightsState, uses } });
  return r.id;
}

export async function updateSourceRights(ctx: Ctx, sourceId: string, rightsState: RightsState, permittedUses: string[], restrictions?: string) {
  const s = await getSourceForManage(ctx, sourceId);
  const uses = permittedUses.filter((u): u is Use => (USES as readonly string[]).includes(u));
  await q(`update legal_sources set rights_state = $2, permitted_uses = $3, restrictions = coalesce($4, restrictions), last_checked_at = now() where id = $1`,
    [sourceId, rightsState, uses, restrictions ?? null]);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'source.rights_update', targetType: 'source', targetId: sourceId,
    meta: { from: s.rights_state, to: rightsState, uses } });
}

async function getSourceForManage(ctx: Ctx, sourceId: string) {
  const s = await one<SourceRow>(`select * from legal_sources where id = $1`, [sourceId]);
  if (!s || !canManageSource(ctx, s)) throw new DomainError('not_found_or_denied', 'Source not found.');
  return s;
}

export async function listSources(ctx: Ctx) {
  const sc = await scopeClause(ctx, 's', 1);
  return q<SourceRow & { versions: number; passages: number }>(
    `select s.*, (select count(*)::int from source_versions v where v.source_id = s.id) as versions,
            (select count(*)::int from passages p where p.source_id = s.id) as passages
       from legal_sources s where ${sc.sql} order by s.scope, s.title`, sc.params);
}

export async function getSourceDetail(ctx: Ctx, sourceId: string) {
  const sc = await scopeClause(ctx, 's', 2);
  const s = await one<SourceRow>(`select s.* from legal_sources s where s.id = $1 and ${sc.sql}`, [sourceId, ...sc.params]);
  if (!s) throw new DomainError('not_found_or_denied', 'Source not found or not in your permitted scope.');
  const versions = await q<{ id: string; version_label: string; effective_date: string | null; checked_at: Date; sha256: string;
    extraction_version: string; reviewed_status_note: string | null; superseded_by: string | null; passages: number }>(
    `select v.id, v.version_label, to_char(v.effective_date,'YYYY-MM-DD') as effective_date, v.checked_at, v.sha256, v.extraction_version,
            v.reviewed_status_note, v.superseded_by, (select count(*)::int from passages p where p.source_version_id = v.id) as passages
       from source_versions v where v.source_id = $1 order by v.created_at desc`, [sourceId]);
  const log = await q<{ outcome: string; message: string; created_at: Date }>(
    `select outcome, message, created_at from ingestion_log where source_id = $1 order by created_at desc limit 20`, [sourceId]);
  const displayable = s.rights_state === 'cleared' && s.permitted_uses.includes('display');
  const passages = displayable && versions[0]
    ? await q<{ id: string; locator: string; text: string }>(`select id, locator, text from passages where source_version_id = $1 order by seq`, [versions[0].id])
    : [];
  return { source: s, versions, log, passages, displayable, canManage: canManageSource(ctx, s) };
}

// ---- Ingestion (FR-007) ----

export function segment(text: string): { locator: string; text: string }[] {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b, i) => {
    const m = b.match(/^((?:Art(?:icle)?\.?|Sec(?:tion)?\.?|Rule)\s*[0-9IVXLC]+(?:\.[0-9]+)?)[.:\s]/i);
    return { locator: m ? m[1].replace(/\s+/g, ' ') : `¶${i + 1}`, text: b };
  });
}

export interface IngestInput { versionLabel: string; effectiveDate?: string; text: string; reviewedStatusNote?: string }

export async function ingestSource(ctx: Ctx, sourceId: string, input: IngestInput) {
  const s = await getSourceForManage(ctx, sourceId);
  const logIt = async (outcome: string, message: string, hash: string | null, t?: Queryable) => {
    await q(`insert into ingestion_log(source_id, outcome, message, sha256, actor_id) values ($1,$2,$3,$4,$5)`, [sourceId, outcome, message, hash, ctx.userId], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'source.ingest', targetType: 'source', targetId: sourceId,
      outcome: outcome === 'ingested' ? 'ok' : outcome === 'duplicate' ? 'ok' : 'denied', meta: { outcome } }, t);
  };
  if (s.rights_state !== 'cleared' || !s.permitted_uses.includes('ingest') || !s.permitted_uses.includes('index')) {
    await logIt('blocked_rights', `Blocked: rights state "${s.rights_state}" with permitted uses [${s.permitted_uses.join(', ') || 'none'}]. Ingest and index permissions are both required.`, null);
    throw new DomainError('rights_blocked', 'Ingestion blocked: this source does not have cleared rights for ingestion and indexing.');
  }
  const text = input.text.replace(/\r\n/g, '\n').trim();
  const hash = sha256(text);
  const parts = segment(text);
  if (!text || !parts.length || parts.every((p) => p.text.length < 20)) {
    await logIt('extraction_failed', 'Extraction produced no usable passages; nothing was marked verified.', text ? hash : null);
    throw new DomainError('invalid_input', 'Extraction failed: no usable text found.');
  }
  return tx(async (t) => {
    const dup = await one<{ id: string; version_label: string }>(`select id, version_label from source_versions where source_id = $1 and sha256 = $2`, [sourceId, hash], t);
    if (dup) {
      await logIt('duplicate', `Identical text already ingested as version "${dup.version_label}" (hash ${hash.slice(0, 12)}…).`, hash, t);
      return { versionId: dup.id, duplicate: true, passages: 0 };
    }
    const prev = await one<{ id: string }>(`select id from source_versions where source_id = $1 and superseded_by is null order by created_at desc limit 1`, [sourceId], t);
    const v = (await one<{ id: string }>(
      `insert into source_versions(source_id, version_label, effective_date, sha256, original_text, extraction_version, reviewed_status_note)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [sourceId, input.versionLabel.trim() || 'v1', input.effectiveDate || null, hash, text, `segmenter-v1+${EMBEDDING_MODEL}`,
        input.reviewedStatusNote?.trim() || null], t))!;
    if (prev) await q(`update source_versions set superseded_by = $2 where id = $1`, [prev.id, v.id], t);
    let seq = 0;
    for (const p of parts) {
      await q(`insert into passages(source_version_id, source_id, seq, locator, text, text_hash, embedding) values ($1,$2,$3,$4,$5,$6,$7)`,
        [v.id, sourceId, seq++, p.locator, p.text, sha256(p.text), toPgVector(embed(p.text))], t);
    }
    await q(`update legal_sources set last_checked_at = now() where id = $1`, [sourceId], t);
    const flagged = parts.filter((p) => looksLikeInstruction(p.text)).map((p) => p.locator);
    await logIt('ingested', `Ingested ${parts.length} passages (hash ${hash.slice(0, 12)}…).` +
      (flagged.length ? ` Warning: instruction-like text in ${flagged.join(', ')} — treated as data and excluded from AI composition.` : ''), hash, t);
    return { versionId: v.id, duplicate: false, passages: parts.length };
  });
}

// ---- Freshness / status warnings (FR-009) ----

export interface PassageHit {
  passage_id: string; locator: string; text: string; source_id: string; source_title: string; authority: string;
  source_type: string; court: string | null; url: string | null; scope: Scope; version_id: string; version_label: string;
  effective_date: string | null; checked_at: Date; reviewed_status_note: string | null; superseded: boolean;
  is_test_fixture: boolean; permitted_uses: Use[]; score: number; kw: number; sem: number; warnings: string[];
}

export function statusWarnings(h: Pick<PassageHit, 'checked_at' | 'effective_date' | 'reviewed_status_note' | 'superseded' | 'is_test_fixture'>): string[] {
  const w: string[] = [];
  const ageDays = (Date.now() - new Date(h.checked_at).getTime()) / 86400000;
  if (ageDays > STALE_AFTER_DAYS) w.push(`Source status needs review; last checked ${new Date(h.checked_at).toISOString().slice(0, 10)}.`);
  if (!h.effective_date) w.push('Effective date unknown — not assumed current.');
  if (h.superseded) w.push('A newer version of this source exists.');
  if (!h.reviewed_status_note) w.push('Amendment and negative-treatment status not verified. A citation is not proof the authority remains good law.');
  if (h.is_test_fixture) w.push('TEST FIXTURE — synthetic text, not an actual legal source.');
  return w;
}

// ---- Hybrid search (FR-008) ----

export interface SearchInput {
  query: string; mode: 'hybrid' | 'keyword'; requireUse?: Use; sourceTypes?: string[]; court?: string;
  dateFrom?: string; dateTo?: string; scopes?: Scope[]; matterId?: string; limit?: number;
}

/**
 * Permission and rights filters are part of the WHERE clause, applied before any ranking.
 * Only the latest (non-superseded) version is searched; older versions remain viewable on the source page.
 */
export async function searchPassages(ctx: Ctx, input: SearchInput): Promise<PassageHit[]> {
  await requirePerm(ctx, 'research');
  const query = input.query.trim();
  if (!query) return [];
  if (input.matterId) await assertMatterAccess(ctx, input.matterId);
  const use = input.requireUse ?? 'display';
  const sc = await scopeClause(ctx, 's', 1);
  const params: unknown[] = [...sc.params];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = [sc.sql, `s.rights_state = 'cleared'`, `'index' = any(s.permitted_uses)`, `${p(use)} = any(s.permitted_uses)`, `v.superseded_by is null`];
  if (input.sourceTypes?.length) where.push(`s.source_type = any(${p(input.sourceTypes)}::text[])`);
  if (input.court?.trim()) where.push(`s.court ilike ${p('%' + input.court.trim() + '%')}`);
  if (input.dateFrom) where.push(`v.effective_date >= ${p(input.dateFrom)}::date`);
  if (input.dateTo) where.push(`v.effective_date <= ${p(input.dateTo)}::date`);
  if (input.scopes?.length) where.push(`s.scope = any(${p(input.scopes)}::text[])`);
  if (input.matterId) where.push(`(s.scope <> 'matter' or s.matter_id = ${p(input.matterId)})`);
  // Manual search matches ANY meaningful term (ranked by how many match), not all of them.
  const terms = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
  const tsq = p(terms.length ? terms.join(' or ') : query);
  const semantic = input.mode === 'hybrid';
  const vec = semantic ? p(toPgVector(embed(query))) : null;
  const limit = p(input.limit ?? 12);
  const rows = await q<Omit<PassageHit, 'warnings'>>(
    `with filtered as (
       select pa.id as passage_id, pa.locator, pa.text, s.id as source_id, s.title as source_title, s.authority, s.source_type, s.court, s.url,
              s.scope, v.id as version_id, v.version_label, to_char(v.effective_date,'YYYY-MM-DD') as effective_date, v.checked_at,
              v.reviewed_status_note, (v.superseded_by is not null) as superseded, s.is_test_fixture, s.permitted_uses,
              ts_rank_cd(pa.tsv, websearch_to_tsquery('english', ${tsq})) as kw,
              ${semantic ? `1 - (pa.embedding <=> ${vec}::vector)` : '0'} as sem,
              (pa.tsv @@ websearch_to_tsquery('english', ${tsq})) as kw_match
         from passages pa join source_versions v on v.id = pa.source_version_id join legal_sources s on s.id = pa.source_id
        where ${where.join(' and ')}
     )
     select *, (least(kw, 1) * 0.6 + greatest(sem, 0) * 0.4) as score from filtered
      where kw_match ${semantic ? 'or sem > 0.15' : ''}
      order by score desc limit ${limit}`, params);
  return rows.map((r) => ({ ...r, kw: Number(r.kw), sem: Number(r.sem), score: Number(r.score), warnings: statusWarnings(r) }));
}

/** Resolve exact passages by ID — re-checking scope and rights at read time (citation QA, FR-014). */
export async function resolvePassages(ctx: Ctx, ids: string[], use: Use = 'display') {
  if (!ids.length) return new Map<string, Omit<PassageHit, 'score' | 'kw' | 'sem'>>();
  const sc = await scopeClause(ctx, 's', 1);
  const rows = await q<Omit<PassageHit, 'warnings' | 'score' | 'kw' | 'sem'> & { rights_state: string }>(
    `select pa.id as passage_id, pa.locator, pa.text, s.id as source_id, s.title as source_title, s.authority, s.source_type, s.court, s.url,
            s.scope, v.id as version_id, v.version_label, to_char(v.effective_date,'YYYY-MM-DD') as effective_date, v.checked_at,
            v.reviewed_status_note, (v.superseded_by is not null) as superseded, s.is_test_fixture, s.permitted_uses, s.rights_state
       from passages pa join source_versions v on v.id = pa.source_version_id join legal_sources s on s.id = pa.source_id
      where pa.id = any($4::uuid[]) and ${sc.sql} and s.rights_state = 'cleared' and $5 = any(s.permitted_uses)`,
    [...sc.params, ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)), use]);
  return new Map(rows.map((r) => [r.passage_id, { ...r, warnings: statusWarnings(r) }]));
}
