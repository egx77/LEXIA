# LEXIA pilot-readiness evidence — 2026-11-18

> **Status of this evidence.** Local prototype, synthetic fictional fixtures only (FD 07 §6). This is *not* pilot or release evidence (FD 07 §1), and it approves nothing: the go/no-go decision belongs to the product owner (FD 08 S6).

## 1. Build and environment (FD 07 §7)

| Item | Value |
|---|---|
| Build | commit `eca752a` |
| Generated | 2026-11-17T19:31:29.342Z |
| Runtime | Node v24.15.0, win32 |
| Database | PGlite (embedded PostgreSQL + pgvector), in-memory for the suite |
| AI adapter | `local-extractive-v1` (deterministic; no external provider, DEV-206/207 pending) |
| Retrieval / embeddings | hybrid full-text + `local-hash-v1` placeholder vectors |
| Fixtures | FD 07 §6 synthetic set (Firm A, Firm B, platform QA tenant) |

## 2. Automated results

- **Unit / integration suite:** 51 of 51 passed — PASS
- **End-to-end smoke** (http://localhost:3100): 66 of 66 checks passed — PASS

### By FD 07 test case

| Test case | Result |
|---|---|
| TC-001 | PASS |
| TC-002 | PASS |
| TC-003 | PASS |
| TC-004 | PASS |
| TC-005 | PASS |
| TC-006 | PASS |
| TC-007 | PASS |
| TC-008 | PASS |
| TC-009 | PASS |
| TC-010 | PASS |
| TC-011 | PASS |
| TC-012 | PASS |
| TC-013 | PASS |
| TC-014 | PASS |
| TC-015 | PASS |
| TC-017 | PASS |
| TC-019 | PASS |
| TC-020 | PASS |
| TC-021 | PASS |
| TC-022 | PASS |
| TC-023 | PASS |
| TC-024 | PASS |
| TC-027 | PASS |
| TC-028 | PASS |
| TC-029 | PASS |
| TC-030 | PASS |
| TC-031 | PASS |
| TC-032 | PASS |
| TC-033 | PASS |
| TC-034 | PASS |
| TC-035 | PASS |
| TC-036 | PASS |
| TC-037 | PASS |
| TC-038 | PASS |

**No automated test in this build:** TC-016, TC-018, TC-025, TC-026. These need manual or pilot evidence (FD 07 §2 says what each one checks).

### S6 hardening checks

| Check | Result |
|---|---|
| Sign-in throttling, no account enumeration, no secrets in audit | PASS |
| Broken-object authorization sweep (other firm, direct IDs) | PASS |
| FR-036 blinded recognition review (TC-030 mechanism) | PASS |
| Backup → restore: checksum, row counts, scoped-access integrity, append-only audit | PASS |
| Accessibility basics on key screens (lang, one h1, skip link, labelled controls) | PASS |

<details><summary>All 51 tests</summary>

| File | Test | Result |
|---|---|---|
| coverage.test.ts | TC-017 conversation: citations and fallback (FR-017) › answers through grounded research, falls back to keyword search in an outage, and keeps chats per user | passed |
| coverage.test.ts | TC-019 entitlements: idempotency and no charging (FR-019) › a retried request with the same idempotency key is refused, so it is metered once; nothing is charged | passed |
| coverage.test.ts | TC-020 online-first: no private offline cache (FR-020, DEV-106) › the service worker never caches /app or /api, and private responses are marked no-store | passed |
| coverage.test.ts | TC-023 legal policies: versioned consent (FR-023) › a new user must accept every current policy version; acceptance is audited; drafts are labelled unreviewed | passed |
| coverage.test.ts | TC-024 scorecard numerators and evidence (FR-024) › counts add up to their denominators, match the drafts, and are admin-only | passed |
| drafting.test.ts | TC-011 research-to-memo, approval and export (FR-011, J-001) › creates an editable memo, binds approval to the exact version, invalidates on edit | passed |
| drafting.test.ts | TC-013 / TC-027 pleading and DNA modes (FR-013, FR-033, J-002) › keeps fact labels, offers neutral comparison, and modes change only style/structure | passed |
| drafting.test.ts | TC-013 / TC-027 pleading and DNA modes (FR-013, FR-033, J-002) › assistants can draft but DNA is never applied for them | passed |
| drafting.test.ts | TC-021 AI continuity (FR-021, AC-005) › quota exhaustion mid-draft leaves a recoverable partial draft that can be edited and exported | passed |
| drafting.test.ts | TC-021 AI continuity (FR-021, AC-005) › provider outage produces a manual template, never a fabricated draft | passed |
| drafting.test.ts | TC-021 AI continuity (FR-021, AC-005) › external actions are refused (FD 06 §8) | passed |
| drafting.test.ts | TC-015 / TC-022 matter isolation for drafts › another tenant cannot open, export or draft into the matter | passed |
| drafting.test.ts | TC-028 sample isolation (FR-034, AC-010) › a lawyer cannot read another lawyer’s sample or profile | passed |
| drafting.test.ts | TC-029 feedback accept/reject/undo (FR-035, AC-011) › rejected proposals never change the profile; accept creates a version; undo restores | passed |
| drafting.test.ts | TC-012 consent withdrawal (FR-012, AC-004) › withdrawal stops profile use → neutral; new samples need consent | passed |
| foundation.test.ts | TC-001 registration / isolation (FR-001) › rejects invalid input and duplicates, requires verification | passed |
| foundation.test.ts | TC-002 grant and revoke (FR-002) › revoked user loses access and sessions; cross-firm denied | passed |
| foundation.test.ts | TC-002 grant and revoke (FR-002) › non-admins cannot invite; billing staff has no matter access | passed |
| foundation.test.ts | TC-003 matter records (FR-003) › create/edit/archive with optimistic concurrency and history | passed |
| foundation.test.ts | TC-003 matter records (FR-003) › firm admin without assignment cannot open another lawyer’s matter | passed |
| foundation.test.ts | TC-004 document repository (FR-004) › keeps immutable versions with hashes and denies unassigned users | passed |
| foundation.test.ts | TC-005 tasks/deadlines (FR-005, AC-007) › suggested deadlines stay unverified until a lawyer confirms; assistants cannot confirm | passed |
| foundation.test.ts | TC-022 audit is append-only (FR-022) › rejects updates and deletes on audit events | passed |
| hardening.test.ts | S6 — sign-in throttling (FR-022) › locks an email after repeated failures, even for the right password, without revealing whether it exists | passed |
| hardening.test.ts | S6 — sign-in throttling (FR-022) › a password reset unlocks sign-in | passed |
| hardening.test.ts | S6 — sign-in throttling (FR-022) › never writes passwords or session tokens into the audit log | passed |
| hardening.test.ts | S6 — broken-object authorization sweep (FD 07 §4 security) › a lawyer in another firm gets “not found” for every Firm A object, by direct ID | passed |
| hardening.test.ts | S6 — FR-036 blinded recognition review (TC-030) › shows the lawyer’s own DNA draft and its neutral twin unlabeled, and reveals only after a consented answer | passed |
| hardening.test.ts | S6 — FR-036 blinded recognition review (TC-030) › nobody else can open a lawyer’s review, and the firm summary needs admin rights | passed |
| hardening.test.ts | S6 — backup and restore (FD 07 §5 recovery gate) › a backup restores with identical row counts and passes every scoped-access check | passed |
| hardening.test.ts | S6 — backup and restore (FD 07 §5 recovery gate) › detects a tampered backup and a cross-tenant row | passed |
| knowledge.test.ts | TC-006 rights enforcement (FR-006, DEV-101) › unknown/restricted rights block ingestion and are logged | passed |
| knowledge.test.ts | TC-006 rights enforcement (FR-006, DEV-101) › only QA editors manage the shared core; lawyers need rights attestation for reference uploads | passed |
| knowledge.test.ts | TC-007 provenance/hash (FR-007) › records hash, detects duplicates and flags failed extraction | passed |
| knowledge.test.ts | TC-008 permissions before ranking (FR-008) › never returns another tenant’s firm library, unassigned matter sources, restricted or suspended sources | passed |
| knowledge.test.ts | TC-008 permissions before ranking (FR-008) › keyword search works with AI unavailable | passed |
| knowledge.test.ts | TC-009 freshness warnings (FR-009) › flags stale check dates, unknown effective dates and unverified treatment | passed |
| knowledge.test.ts | TC-010 / TC-014 verified research and citation QA (FR-010, FR-014, AC-001) › every verified claim resolves to an exact authorized passage | passed |
| knowledge.test.ts | TC-010 / TC-014 verified research and citation QA (FR-010, FR-014, AC-001) › a fabricated citation never receives a verified badge | passed |
| knowledge.test.ts | TC-010 / TC-014 verified research and citation QA (FR-010, FR-014, AC-001) › no permitted source → unverified, never fabricated | passed |
| knowledge.test.ts | TC-010 / TC-014 verified research and citation QA (FR-010, FR-014, AC-001) › prompt-injection text in a retrieved source is treated as data | passed |
| knowledge.test.ts | TC-010 / TC-014 verified research and citation QA (FR-010, FR-014, AC-001) › research with exhausted quota returns keyword hits only (FR-021) | passed |
| knowledge.test.ts | TC-010 / TC-014 verified research and citation QA (FR-010, FR-014, AC-001) › revoking rights stops serving a source | passed |
| workdesk.test.ts | Work Desk — task catalog › TC-031 never lets a "coming later" task be started and keeps ids unique | passed |
| workdesk.test.ts | Work Desk — task catalog › TC-032 matches plain-language instructions to the right task | passed |
| workdesk.test.ts | Work Desk — task catalog › TC-033 reports a requested template honestly instead of substituting another | passed |
| workdesk.test.ts | Work Desk — task catalog › TC-034 detects "continue" intent | passed |
| workdesk.test.ts | Work Desk — task catalog › TC-035 filters runnable tasks by role (deny-by-default) | passed |
| workdesk.test.ts | Work Desk — continue work and attention are scoped › TC-036 shows only work from assigned matters in the user’s own firm | passed |
| workdesk.test.ts | Work Desk — continue work and attention are scoped › TC-037 only lawyers see drafts awaiting their approval; billing staff see no matter work | passed |
| workdesk.test.ts | Work Desk — continue work and attention are scoped › TC-038 a task can only be assigned to someone already on the matter | passed |

</details>

## 3. Quality gates (FD 07 §5)

| Gate | Prototype evidence | Still required before a pilot with real matters |
|---|---|---|
| Source authenticity | Verified label only on exact authorized passages (TC-010/014: PASS) | Real rights-cleared sources (DEV-101); lawyer review log |
| Privacy and isolation | Isolation suites + S6 sweep above | Independent security review; threat model |
| Personalization | Blind-review tool built; results counted on the scorecard | Consenting pilot lawyers to produce the actual measurements |
| Legal correctness | No fabricated citation can be labelled verified (TC-014) | Lawyer-reviewed error register on representative cases |
| Continuity | AI outage and exhausted quota keep work usable (TC-021: PASS) | Outage drill on the pilot environment |
| Accessibility | Automated basics (smoke) | Full audit and observed user sessions |
| Recovery | Backup/restore verified with integrity report | Recovery targets (pending); restore drill on pilot hosting (DEV-201/204) |
| Cost | Units metered per run; quotas enforced; per-approved-draft figure on scorecard | Approved cost model and prices |

Numerical targets are deliberately absent (DEV-105, DEV-209).

## 4. Before-pilot checklist (FD 07 §8)

| Item | Status |
|---|---|
| Representative synthetic test results | This report |
| Legal source rights (DEV-101) | **Pending — owner** |
| Policies (terms, privacy, AI disclosure, DNA notice) reviewed by a lawyer | **Pending — owner** (currently `0.1-draft`) |
| Consent language (pilot participation, DNA, blind review) reviewed | **Pending — owner** |
| Support and incident process | **Pending — owner** |
| Participant agreement | **Pending — owner** |
| AI provider and data terms, if the pilot uses a real model (DEV-206/207) | **Pending — owner** |
| Pilot hosting, MFA and email delivery (DEV-201/204/205) | **Pending — technical lead** |

## 5. Owner go/no-go

FD 08 §6 allows fictional cases for initial security and correctness checks; live confidential matters need the rights, privacy and participant items above.

- Pilot with **fictional cases only**: Go / No-go: ____
- Pilot with **real client matters**: Go / No-go: ____ (not possible until every section 4 item is done)

Decided by: ____  Date: ____
