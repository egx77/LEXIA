/**
 * FD 04 — Data & Backend Schema (conceptual contracts made physical for the prototype).
 * DEV-201 (physical DB/indexing) is still pending: this is the PostgreSQL + pgvector
 * prototype direction accepted in DEV-102, not a production-approved schema.
 */
export const SCHEMA_VERSION = 2;

export const SCHEMA = /* sql */ `
create extension if not exists vector;

create table if not exists schema_meta (key text primary key, value text not null);

-- Tenancy, identity, roles (FR-001, FR-002, FR-022)
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'firm' check (kind in ('firm','platform')),
  ai_simulation text not null default 'none'
    check (ai_simulation in ('none','outage','timeout','fabricated_citation','malicious_instruction')),
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  password_hash text not null,
  email_verified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists users_email_uq on users (lower(email));

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  roles text[] not null,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id, user_id)
);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  email text not null,
  roles text[] not null,
  token_hash text not null unique,
  invited_by uuid not null references users(id),
  accepted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists auth_tokens (
  token_hash text primary key,
  user_id uuid not null references users(id),
  purpose text not null check (purpose in ('verify_email','reset_password')),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id),
  tenant_id uuid references tenants(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

-- Clients and matters (FR-003, FR-015)
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  kind text not null default 'individual' check (kind in ('individual','organization')),
  created_at timestamptz not null default now()
);

create table if not exists matters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_id uuid not null references clients(id),
  title text not null,
  practice_area text not null default 'General Practice',
  opposing_party text,
  issues text not null default '',
  status text not null default 'active' check (status in ('active','closed','archived')),
  version int not null default 1,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists matter_assignments (
  matter_id uuid not null references matters(id),
  user_id uuid not null references users(id),
  granted_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  primary key (matter_id, user_id)
);

-- Object storage adapter (DB-backed for the prototype; DEV-204 pending)
create table if not exists objects (
  key text primary key,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

-- Matter documents and immutable versions (FR-004)
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  matter_id uuid not null references matters(id),
  title text not null,
  rights_attested_by uuid not null references users(id),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  version int not null,
  filename text not null,
  mime text not null,
  size_bytes int not null,
  sha256 text not null,
  object_key text not null,
  extracted_text text,
  extraction_status text not null default 'ok' check (extraction_status in ('ok','failed','not_supported')),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

-- Facts / chronology (FR-015, FR-026 basics)
create table if not exists facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  matter_id uuid not null references matters(id),
  statement text not null,
  classification text not null check (classification in ('allegation','evidence','finding','unverified')),
  occurred_on date,
  source_document_version_id uuid references document_versions(id),
  source_locator text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

-- Tasks and deadlines (FR-005)
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  matter_id uuid not null references matters(id),
  title text not null,
  kind text not null default 'task' check (kind in ('task','deadline')),
  origin text not null default 'manual' check (origin in ('manual','suggested')),
  owner_id uuid references users(id),
  due_at timestamptz,
  timezone text not null default 'Asia/Manila',
  verification_status text not null default 'unverified' check (verification_status in ('unverified','confirmed','rejected')),
  verified_by uuid references users(id),
  verified_at timestamptz,
  evidence_note text,
  source_fact_id uuid references facts(id),
  status text not null default 'open' check (status in ('open','done')),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  remind_on date not null,
  created_at timestamptz not null default now(),
  unique (task_id, remind_on)
);

create table if not exists action_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  plan_date date not null,
  items jsonb not null,
  created_at timestamptz not null default now()
);

-- Legal knowledge: registry, rights, versions, passages (FR-006..FR-009, four library scopes FS-045)
create table if not exists legal_sources (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'core' check (scope in ('core','firm','personal','matter')),
  tenant_id uuid references tenants(id),
  owner_user_id uuid references users(id),
  matter_id uuid references matters(id),
  title text not null,
  authority text not null,
  source_type text not null check (source_type in ('constitution','statute','decision','rule','issuance','reference')),
  court text,
  url text,
  access_method text not null default 'manual',
  coverage text,
  owner text,
  restrictions text,
  rights_state text not null default 'unknown' check (rights_state in ('unknown','cleared','restricted','suspended')),
  permitted_uses text[] not null default '{}',
  last_checked_at timestamptz,
  is_test_fixture boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check ((scope = 'core' and tenant_id is null) or (scope <> 'core' and tenant_id is not null)),
  check (scope <> 'personal' or owner_user_id is not null),
  check (scope <> 'matter' or matter_id is not null)
);

create table if not exists source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references legal_sources(id),
  version_label text not null,
  effective_date date,
  checked_at timestamptz not null default now(),
  sha256 text not null,
  original_text text not null,
  extraction_version text not null,
  reviewed_status_note text,
  superseded_by uuid references source_versions(id),
  created_at timestamptz not null default now(),
  unique (source_id, sha256)
);

create table if not exists passages (
  id uuid primary key default gen_random_uuid(),
  source_version_id uuid not null references source_versions(id),
  source_id uuid not null references legal_sources(id),
  seq int not null,
  locator text not null,
  text text not null,
  text_hash text not null,
  tsv tsvector generated always as (to_tsvector('english', text)) stored,
  embedding vector(256)
);
create index if not exists passages_tsv_idx on passages using gin (tsv);
create index if not exists passages_source_idx on passages (source_id);

create table if not exists ingestion_log (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references legal_sources(id),
  outcome text not null check (outcome in ('ingested','blocked_rights','duplicate','extraction_failed')),
  message text not null,
  sha256 text,
  actor_id uuid references users(id),
  created_at timestamptz not null default now()
);

-- Research (FR-008, FR-010, FR-014, FR-017)
create table if not exists research_queries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  matter_id uuid references matters(id),
  question text not null,
  scope jsonb not null,
  result jsonb,
  ai_run_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  matter_id uuid references matters(id),
  role text not null check (role in ('user','assistant','system')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

-- Drafts, versions, approvals (FR-011, FR-013, FR-014, FR-033)
create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  matter_id uuid references matters(id),
  title text not null,
  doc_type text not null,
  dna_mode text not null default 'neutral' check (dna_mode in ('neutral','writing','reasoning','combined')),
  applied_writing_version int,
  applied_reasoning_version int,
  status text not null default 'draft' check (status in ('draft','in_review','approved','superseded')),
  current_version int not null default 0,
  research_query_id uuid references research_queries(id),
  neutral_content jsonb,
  generation_state text not null default 'complete' check (generation_state in ('complete','partial','manual')),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id),
  version int not null,
  content jsonb not null,
  content_hash text not null,
  author_kind text not null check (author_kind in ('ai','lawyer','assistant','system')),
  created_by uuid not null references users(id),
  ai_run_id uuid,
  note text,
  created_at timestamptz not null default now(),
  unique (draft_id, version)
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  target_type text not null,
  target_id uuid not null,
  target_version int not null,
  action text not null,
  action_hash text not null,
  acknowledged_open_items int not null default 0,
  actor_id uuid not null references users(id),
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);

-- Lawyer DNA (FR-012, FR-031..FR-036)
create table if not exists dna_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  lawyer_id uuid not null references users(id),
  purpose text not null check (purpose in ('writing','reasoning')),
  notice_version text not null,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table if not exists dna_samples (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  lawyer_id uuid not null references users(id),
  matter_id uuid references matters(id),
  title text not null,
  practice_area text,
  doc_type text,
  provenance text not null,
  confidentiality text not null check (confidentiality in ('non_confidential','confidential_permitted','public_record')),
  authority_attested boolean not null,
  purposes text[] not null,
  text text not null,
  sha256 text not null,
  status text not null default 'active' check (status in ('active','withdrawn')),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  unique (lawyer_id, sha256)
);

create table if not exists dna_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  lawyer_id uuid not null references users(id),
  type text not null check (type in ('writing','reasoning')),
  version int not null,
  traits jsonb not null,
  status text not null check (status in ('draft','active','disabled','superseded','revoked')),
  approved_by uuid references users(id),
  approved_at timestamptz,
  source_note text,
  created_at timestamptz not null default now(),
  unique (lawyer_id, type, version)
);
create unique index if not exists dna_one_active on dna_profiles (lawyer_id, type) where status = 'active';

create table if not exists dna_feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  lawyer_id uuid not null references users(id),
  draft_id uuid not null references drafts(id),
  type text not null check (type in ('writing','reasoning')),
  base_profile_version int not null,
  proposal jsonb not null,
  status text not null default 'proposed' check (status in ('proposed','accepted','rejected','undone')),
  resulting_profile_version int,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- AI runs and usage (FR-016, FR-021, FR-024)
create table if not exists ai_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  matter_id uuid references matters(id),
  kind text not null,
  model_adapter text not null,
  status text not null check (status in ('running','completed','partial','failed','cancelled','unavailable')),
  quota_status text not null default 'ok' check (quota_status in ('ok','exhausted')),
  units int not null default 0,
  steps jsonb not null default '[]',
  error_code text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Plans and entitlements (FR-019) — unpriced placeholders only (B-02, DEV-104)
create table if not exists plans (
  code text primary key,
  name text not null,
  summary text not null,
  placeholder_ai_units int not null,
  is_placeholder boolean not null default true
);

create table if not exists entitlements (
  tenant_id uuid primary key references tenants(id),
  plan_code text not null references plans(code),
  ai_units_quota int not null,
  ai_units_used int not null default 0,
  period_start date not null default current_date,
  payment_state text not null default 'pending_provider_approval'
    check (payment_state in ('pending_provider_approval','not_required'))
);

-- Policies (FR-023) — text pending responsible legal review
create table if not exists policy_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms','privacy','ai_disclosure','subscription','dna_notice')),
  version text not null,
  review_status text not null default 'pending_legal_review' check (review_status in ('pending_legal_review','approved')),
  body text not null,
  unique (kind, version)
);

create table if not exists policy_acceptances (
  user_id uuid not null references users(id),
  policy_id uuid not null references policy_documents(id),
  accepted_at timestamptz not null default now(),
  primary key (user_id, policy_id)
);

create table if not exists demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  firm text,
  message text,
  created_at timestamptz not null default now()
);

-- Audit (FR-022) — append-only
create table if not exists audit_events (
  id bigserial primary key,
  tenant_id uuid,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  outcome text not null default 'ok' check (outcome in ('ok','denied','failed')),
  purpose text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function audit_append_only() returns trigger as $$
begin
  raise exception 'audit_events is append-only';
end;
$$ language plpgsql;

drop trigger if exists audit_no_update on audit_events;
create trigger audit_no_update before update or delete on audit_events
  for each row execute function audit_append_only();

-- Sign-in throttling (FR-022, FD 07 §4 security). Keyed by a hash of the normalized email,
-- whether or not the account exists, so lockout does not reveal which emails are registered.
create table if not exists auth_throttle (
  key_hash text primary key,
  failures int not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);

-- FR-036 blinded recognition review (S6 pilot). The reviewer sees the personalized and the neutral
-- version of their own draft as unlabeled A/B; the order is fixed server-side when the review starts.
create table if not exists pilot_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  draft_id uuid not null references drafts(id),
  reviewer_id uuid not null references users(id),
  personalized_is_a boolean not null,
  voice_pick text check (voice_pick in ('a','b','unsure')),
  approach_pick text check (approach_pick in ('a','b','unsure')),
  legal_issue text check (legal_issue in ('none','a','b','both')),
  edit_effort text check (edit_effort in ('none','light','moderate','heavy')),
  comment text,
  consent_pilot_use boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (draft_id, reviewer_id)
);
`;
