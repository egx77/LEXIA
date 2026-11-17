import { audit } from './audit';
import { assertMatterAccess, can, requirePerm, type Ctx, type MatterRow } from './authz';
import { sha256 } from './crypto';
import { one, q, tx } from './db';
import { DomainError } from './errors';
import { extractText, MAX_UPLOAD_BYTES, mimeFor, sniffOk } from './extract';

// ---- Clients & matters (FR-003) ----

export interface NewMatter {
  clientName: string; clientKind?: 'individual' | 'organization'; title: string;
  practiceArea?: string; opposingParty?: string; issues?: string;
}

export async function createMatter(ctx: Ctx, input: NewMatter) {
  await requirePerm(ctx, 'create_matter');
  const title = input.title.trim();
  const clientName = input.clientName.trim();
  if (!title || !clientName) throw new DomainError('invalid_input', 'Client and matter title are required.');
  return tx(async (t) => {
    let client = await one<{ id: string }>(`select id from clients where tenant_id = $1 and lower(name) = lower($2)`, [ctx.tenantId, clientName], t);
    if (!client) {
      client = (await one<{ id: string }>(`insert into clients(tenant_id, name, kind) values ($1,$2,$3) returning id`,
        [ctx.tenantId, clientName, input.clientKind ?? 'individual'], t))!;
    }
    const m = (await one<{ id: string; version: number }>(
      `insert into matters(tenant_id, client_id, title, practice_area, opposing_party, issues, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id, version`,
      [ctx.tenantId, client.id, title, input.practiceArea?.trim() || 'General Practice', input.opposingParty?.trim() || null,
        input.issues?.trim() ?? '', ctx.userId], t))!;
    await q(`insert into matter_assignments(matter_id, user_id, granted_by) values ($1,$2,$2)`, [m.id, ctx.userId], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'matter.create', targetType: 'matter', targetId: m.id }, t);
    return { matter_id: m.id, version: m.version };
  });
}

export async function listMatters(ctx: Ctx, opts: { search?: string; status?: string } = {}) {
  if (!can(ctx, 'matter_work')) return [];
  return q<MatterRow & { open_tasks: number }>(
    `select m.*, c.name as client_name,
            (select count(*)::int from tasks t where t.matter_id = m.id and t.status = 'open') as open_tasks
       from matters m join clients c on c.id = m.client_id
       join matter_assignments a on a.matter_id = m.id and a.user_id = $2
      where m.tenant_id = $1
        and ($3::text is null or m.title ilike '%' || $3 || '%' or c.name ilike '%' || $3 || '%')
        and ($4::text is null or m.status = $4)
      order by m.updated_at desc`,
    [ctx.tenantId, ctx.userId, opts.search?.trim() || null, opts.status || null]);
}

export async function getMatter(ctx: Ctx, matterId: string) {
  await requirePerm(ctx, 'matter_work');
  return assertMatterAccess(ctx, matterId);
}

/** Optimistic concurrency: caller passes the version they edited (FD 04 §5). */
export async function updateMatter(ctx: Ctx, matterId: string, baseVersion: number,
  patch: { title?: string; practiceArea?: string; opposingParty?: string; issues?: string; status?: 'active' | 'closed' | 'archived' }) {
  await requirePerm(ctx, 'matter_work');
  return tx(async (t) => {
    const m = await assertMatterAccess(ctx, matterId, t);
    if (patch.status && patch.status !== m.status && !can(ctx, 'approve_legal')) {
      throw new DomainError('forbidden', 'Only a lawyer can close or archive a matter.');
    }
    const row = await one<{ version: number }>(
      `update matters set title = coalesce($3, title), practice_area = coalesce($4, practice_area),
              opposing_party = coalesce($5, opposing_party), issues = coalesce($6, issues), status = coalesce($7, status),
              version = version + 1, updated_at = now()
        where id = $1 and version = $2 returning version`,
      [matterId, baseVersion, patch.title?.trim() || null, patch.practiceArea?.trim() || null,
        patch.opposingParty?.trim() ?? null, patch.issues ?? null, patch.status ?? null], t);
    if (!row) throw new DomainError('conflict', 'This matter was changed by someone else. Reload to see the latest version.');
    const changed = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'matter.update', targetType: 'matter', targetId: matterId,
      meta: { fields: changed, from_version: baseVersion } }, t);
    return row.version;
  });
}

export async function matterHistory(ctx: Ctx, matterId: string) {
  await assertMatterAccess(ctx, matterId);
  return q<{ action: string; actor_name: string | null; meta: Record<string, unknown>; created_at: Date; outcome: string }>(
    `select a.action, u.name as actor_name, a.meta, a.created_at, a.outcome from audit_events a
       left join users u on u.id = a.actor_id
      where a.tenant_id = $1 and a.target_id = $2 order by a.id desc limit 100`, [ctx.tenantId, matterId]);
}

export async function listMatterTeam(ctx: Ctx, matterId: string) {
  await assertMatterAccess(ctx, matterId);
  return q<{ user_id: string; name: string; roles: string[] }>(
    `select a.user_id, u.name, m.roles from matter_assignments a join users u on u.id = a.user_id
       join memberships m on m.user_id = a.user_id and m.tenant_id = $2 and m.status = 'active'
      where a.matter_id = $1 order by u.name`, [matterId, ctx.tenantId]);
}

export async function grantMatter(ctx: Ctx, matterId: string, userId: string) {
  await requirePerm(ctx, 'grant_matter');
  await tx(async (t) => {
    await assertMatterAccess(ctx, matterId, t);
    const member = await one<{ roles: string[] }>(`select roles from memberships where tenant_id = $1 and user_id = $2 and status = 'active'`, [ctx.tenantId, userId], t);
    if (!member) throw new DomainError('invalid_input', 'That person is not an active member of this firm.');
    if (!member.roles.some((r) => r === 'lawyer' || r === 'legal_assistant')) {
      throw new DomainError('invalid_input', 'Only lawyers and legal assistants can be assigned to matters.');
    }
    await q(`insert into matter_assignments(matter_id, user_id, granted_by) values ($1,$2,$3) on conflict do nothing`, [matterId, userId, ctx.userId], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'matter.grant', targetType: 'matter', targetId: matterId, meta: { user_id: userId } }, t);
  });
}

export async function revokeMatterGrant(ctx: Ctx, matterId: string, userId: string) {
  await requirePerm(ctx, 'grant_matter');
  await tx(async (t) => {
    await assertMatterAccess(ctx, matterId, t);
    if (userId === ctx.userId) throw new DomainError('invalid_input', 'You cannot remove your own access here.');
    await q(`delete from matter_assignments where matter_id = $1 and user_id = $2`, [matterId, userId], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'matter.revoke_grant', targetType: 'matter', targetId: matterId, meta: { user_id: userId } }, t);
  });
}

// ---- Facts / chronology (FR-015) ----

export type FactClass = 'allegation' | 'evidence' | 'finding' | 'unverified';
export const FACT_LABEL: Record<FactClass, string> = {
  allegation: 'Allegation', evidence: 'Evidence', finding: 'Finding', unverified: 'Unverified assertion',
};

export interface FactRow {
  id: string; statement: string; classification: FactClass; occurred_on: string | null;
  source_document_version_id: string | null; source_locator: string | null; source_title: string | null; created_at: Date;
}

export async function addFact(ctx: Ctx, matterId: string, input: { statement: string; classification: FactClass; occurredOn?: string; sourceVersionId?: string; locator?: string }) {
  await requirePerm(ctx, 'matter_work');
  if (!input.statement.trim()) throw new DomainError('invalid_input', 'Fact statement is required.');
  if (!['allegation', 'evidence', 'finding', 'unverified'].includes(input.classification)) throw new DomainError('invalid_input', 'Invalid classification.');
  if ((input.classification === 'evidence' || input.classification === 'finding') && !input.sourceVersionId) {
    throw new DomainError('invalid_input', 'Evidence and findings must cite a source document in this matter.');
  }
  return tx(async (t) => {
    await assertMatterAccess(ctx, matterId, t);
    if (input.sourceVersionId) {
      const ok = await one(`select 1 from document_versions v join documents d on d.id = v.document_id where v.id = $1 and d.matter_id = $2`, [input.sourceVersionId, matterId], t);
      if (!ok) throw new DomainError('invalid_input', 'Source document must belong to this matter.');
    }
    const r = (await one<{ id: string }>(
      `insert into facts(tenant_id, matter_id, statement, classification, occurred_on, source_document_version_id, source_locator, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [ctx.tenantId, matterId, input.statement.trim(), input.classification, input.occurredOn || null, input.sourceVersionId || null,
        input.locator?.trim() || null, ctx.userId], t))!;
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'fact.create', targetType: 'matter', targetId: matterId, meta: { fact_id: r.id, classification: input.classification } }, t);
    return r.id;
  });
}

export async function listFacts(ctx: Ctx, matterId: string) {
  await assertMatterAccess(ctx, matterId);
  return q<FactRow>(
    `select f.id, f.statement, f.classification, to_char(f.occurred_on, 'YYYY-MM-DD') as occurred_on, f.source_document_version_id,
            f.source_locator, d.title || ' v' || v.version as source_title, f.created_at
       from facts f left join document_versions v on v.id = f.source_document_version_id left join documents d on d.id = v.document_id
      where f.matter_id = $1 and f.tenant_id = $2 order by f.occurred_on nulls last, f.created_at`, [matterId, ctx.tenantId]);
}

// ---- Documents (FR-004) ----

export interface UploadInput { title?: string; filename: string; mime?: string; bytes: Uint8Array; rightsAttested: boolean; documentId?: string }

export async function uploadDocument(ctx: Ctx, matterId: string, input: UploadInput) {
  await requirePerm(ctx, 'matter_work');
  if (!input.rightsAttested) throw new DomainError('rights_blocked', 'Confirm you are authorized to upload this file for this matter.');
  if (input.bytes.byteLength === 0) throw new DomainError('invalid_input', 'The file is empty.');
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new DomainError('invalid_input', 'File exceeds the pilot upload limit (10 MB, pending DEV-203).');
  const mime = mimeFor(input.filename, input.mime);
  if (!mime) throw new DomainError('invalid_input', 'Unsupported file type. Pilot allowlist: .txt, .docx, .pdf.');
  if (!sniffOk(mime, input.bytes)) throw new DomainError('invalid_input', 'File content does not match its type.');
  // Malware scanning provider is not selected (DEV-203); files are stored but never executed or rendered inline.
  const hash = sha256(input.bytes);
  const { text, status } = await extractText(mime, input.bytes);
  return tx(async (t) => {
    await assertMatterAccess(ctx, matterId, t);
    let docId = input.documentId;
    if (docId) {
      const d = await one(`select 1 from documents where id = $1 and matter_id = $2 and tenant_id = $3`, [docId, matterId, ctx.tenantId], t);
      if (!d) throw new DomainError('not_found_or_denied', 'Document not found in this matter.');
    } else {
      docId = (await one<{ id: string }>(
        `insert into documents(tenant_id, matter_id, title, rights_attested_by, created_by) values ($1,$2,$3,$4,$4) returning id`,
        [ctx.tenantId, matterId, input.title?.trim() || input.filename, ctx.userId], t))!.id;
    }
    const next = (await one<{ v: number }>(`select coalesce(max(version),0)+1 as v from document_versions where document_id = $1`, [docId], t))!.v;
    const key = `t/${ctx.tenantId}/m/${matterId}/${hash}`;
    await q(`insert into objects(key, bytes) values ($1,$2) on conflict (key) do nothing`, [key, input.bytes], t);
    const v = (await one<{ id: string }>(
      `insert into document_versions(document_id, version, filename, mime, size_bytes, sha256, object_key, extracted_text, extraction_status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [docId, next, input.filename, mime, input.bytes.byteLength, hash, key, text, status, ctx.userId], t))!;
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'document.upload', targetType: 'matter', targetId: matterId,
      meta: { document_id: docId, version: next, sha256: hash, extraction: status } }, t);
    return { documentId: docId, versionId: v.id, version: next, extraction: status };
  });
}

export interface DocRow { id: string; title: string; latest_version: number; latest_version_id: string; filename: string; mime: string;
  size_bytes: number; sha256: string; extraction_status: string; updated_at: Date }

export async function listDocuments(ctx: Ctx, matterId: string) {
  await assertMatterAccess(ctx, matterId);
  return q<DocRow>(
    `select d.id, d.title, v.version as latest_version, v.id as latest_version_id, v.filename, v.mime, v.size_bytes, v.sha256,
            v.extraction_status, v.created_at as updated_at
       from documents d join lateral (select * from document_versions where document_id = d.id order by version desc limit 1) v on true
      where d.matter_id = $1 and d.tenant_id = $2 order by v.created_at desc`, [matterId, ctx.tenantId]);
}

export async function listDocumentVersions(ctx: Ctx, matterId: string, documentId: string) {
  await assertMatterAccess(ctx, matterId);
  return q<{ id: string; version: number; filename: string; sha256: string; size_bytes: number; created_at: Date; author: string }>(
    `select v.id, v.version, v.filename, v.sha256, v.size_bytes, v.created_at, u.name as author
       from document_versions v join documents d on d.id = v.document_id join users u on u.id = v.created_by
      where d.id = $1 and d.matter_id = $2 and d.tenant_id = $3 order by v.version desc`, [documentId, matterId, ctx.tenantId]);
}

/** Download an original. Authorization is re-checked on every request (no public object URLs). */
export async function readDocumentVersion(ctx: Ctx, versionId: string) {
  await requirePerm(ctx, 'matter_work');
  const v = await one<{ matter_id: string; filename: string; mime: string; object_key: string }>(
    `select d.matter_id, v.filename, v.mime, v.object_key from document_versions v join documents d on d.id = v.document_id
      where v.id = $1 and d.tenant_id = $2`, [versionId, ctx.tenantId]);
  if (!v) throw new DomainError('not_found_or_denied', 'File not found.');
  await assertMatterAccess(ctx, v.matter_id);
  const obj = await one<{ bytes: Uint8Array }>(`select bytes from objects where key = $1`, [v.object_key]);
  if (!obj) throw new DomainError('not_found_or_denied', 'File not found.');
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'document.download', targetType: 'matter', targetId: v.matter_id, meta: { version_id: versionId } });
  return { filename: v.filename, mime: v.mime, bytes: obj.bytes };
}

/** Structured export of matter records (FR-003). Originals are downloadable individually. */
export async function exportMatter(ctx: Ctx, matterId: string) {
  await requirePerm(ctx, 'export_matter');
  const m = await assertMatterAccess(ctx, matterId);
  const [facts, docs, tasks, drafts] = await Promise.all([
    listFacts(ctx, matterId),
    listDocuments(ctx, matterId),
    q(`select title, kind, origin, due_at, timezone, verification_status, status from tasks where matter_id = $1`, [matterId]),
    q(`select id, title, doc_type, status, current_version from drafts where matter_id = $1`, [matterId]),
  ]);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'matter.export', targetType: 'matter', targetId: matterId });
  return { exported_at: new Date().toISOString(), matter: m, facts, documents: docs, tasks, drafts };
}
