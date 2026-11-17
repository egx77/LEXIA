# LEXIA Counsel — MVP prototype

Implementation of the **LEXIA Product Development Framework v2.0** (FD 01–09, **Revision 03**, 18 Nov 2026, which folds Amendment A-01 into Revision 02): a lawyer-supervised Philippine legal-intelligence workspace for matters, cited research, drafting with optional Lawyer DNA, tasks and Word export.

> **Prototype status.** Runs locally on synthetic, fictional data only. It is not deployed, sends nothing externally, and contains **no real legal sources, prices, retention rules or approved policies**. Every item that the framework lists as pending (DEV-201…210 and others) is a clearly-labelled placeholder. Nothing here is legal advice.

## Quick start

```bash
npm install
npm run dev -- -p 3001 # http://localhost:3001 (any free port works)
```

On first start the server creates an embedded PostgreSQL database in `./.data/pg`. It then seeds the synthetic fixtures from FD 07 §6. Sign in at `/signin`; the page lists the fixture accounts in non-production builds. Every fixture account uses the password `Lexia-Pilot-2026!`.

| Account | Role | Notes |
|---|---|---|
| atty.reyes@lexia.test | Firm admin + lawyer (Firm A) | Formal Writing DNA profile; assigned to Santos v. Bayani |
| atty.cruz@lexia.test | Lawyer (Firm A) | Plain-style DNA; only lawyer on the Ramos labor matter |
| assistant.dela@lexia.test | Legal assistant (Firm A) | Cannot approve or confirm deadlines |
| billing@lexia.test | Billing/admin staff (Firm A) | Usage only; no matter content |
| atty.lim@lexia.test | Lawyer (Firm B) | Isolation test: cannot see Firm A data |
| qa@lexia.test | QA/content editor (platform) | Manages the shared core source library |

| Command | Purpose |
|---|---|
| `npm test` | Unit/integration suite (Vitest, in-memory DB): 38 tests, mapped to FD 07 test cases plus the Work Desk |
| `npm run typecheck` | TypeScript check |
| `npm run build && npm start` | Production build |
| `npm run smoke` | End-to-end smoke test driving real HTML forms against a running server (`BASE=http://localhost:3000`) |
| `npm run db:reset` | Delete the local database. The next start re-seeds it. |

Environment variables are listed in `.env.example`:
- `LEXIA_DATA_DIR` sets where the database lives.
- `LEXIA_ENV` disables fixtures, dev links and fault simulation when set to `production`.
- `LEXIA_SEED_FIXTURES` turns fixture seeding on or off.

## Work Desk (task-oriented workspace)

After sign-in, the lawyer sees one question, **"What would you like to do today?"**, instead of a list of modules. This implements **Amendment A-01 — Task-Oriented Legal Workspace**, adopted 18 Nov 2026 and folded into FD 01–09 as Revision 03 (UX-103, FR-037–042, J-005, FLOW-007–009, TC-031–038, slice S7).

Owner decisions recorded with the amendment:
- **DEV-211 — Yes.** A task is labelled Ready only with an approved requirement, lawyer-reviewed template or rules, and passing tests. Everything else stays Coming later and is not built or simulated.
- **DEV-212 — Yes.** Instruction matching stays deterministic keyword matching until an AI provider is approved (DEV-206/207).
- **DEV-213 — Yes.** No voice input in the MVP.

| Layer | What it is | Where |
|---|---|---|
| **Task Catalog** | What the lawyer sees: 10 categories of action-oriented tasks (Write, Research, Analyze, Review, Prepare, Manage a matter, Notarial, Client, Practice, Learn) | `src/lib/catalog.ts`, `/app/start` |
| **Workflow** | Guided task screens that run the existing permission-checked domain functions in order | `/app/start/[task]`, `startDraftTaskAction` |
| **Functional modules** | Research, matters, drafting, Lawyer DNA, tasks: unchanged and invisible to the lawyer | `src/lib/*` |

- **Continue Work** (`/app/continue`): drafts, research and matters. Views: recent, all, by client, by matter. Each item opens with its versions, sources and open questions.
- **Start New Work** (`/app/start`): the catalog. Each task is labelled **Ready**, **Partly available** (the note says which part works) or **Coming later**. Coming-later tasks cannot be opened, and nothing is simulated.
- **Guided tasks**:
  - *Write a pleading* (Complaint, Answer, Position Paper), *Write a letter* (Demand) and *Write a legal memorandum*: choose the type, then an existing or new matter, then enter facts and issues, attach files and choose Writing/Reasoning DNA. The result is a draft for review.
  - *Set a deadline / Assign a task*: a task can only go to people already on the matter. Only a lawyer's own verification makes a date Confirmed.
- **"Tell LEXIA what you want to do"**: deterministic keyword matching against the catalog and existing work. It only *offers* matching tasks or work; nothing starts until the lawyer clicks. If a requested template doesn't exist (e.g. a Motion), the screen says so instead of substituting another.
- **"Your attention is needed"**:
  - confirmed deadlines that are overdue or due within 7 days;
  - suggested dates waiting for verification;
  - drafts awaiting the lawyer's approval;
  - unfinished drafts.

## Architecture

- **Next.js 16 App Router** server-rendered app:
  - Server Actions in `src/app/actions.ts`.
  - Forms work without JavaScript.
  - Logical API contracts from FD 05 §3 live under `/api/v1`.
- **PGlite** provides embedded PostgreSQL with **pgvector**. The schema is in `src/lib/schema.ts`.
  - Swapping to managed PostgreSQL only means replacing `src/lib/db.ts`, but the hosting decision is pending (DEV-201/204).
- **Domain modules** in `src/lib/`. Every function takes an authenticated `Ctx` and enforces tenant, role and matter access server-side.

  | Module | Responsibility |
  |---|---|
  | `authz.ts` | Role permission matrix (FD 05 §4); matter-assignment checks; denials are audited |
  | `accounts.ts` | Sign-up, email verification, sessions, tenant switching, invitations, role changes, revocation |
  | `matters.ts`, `tasks.ts` | Matters, facts (allegation, evidence, finding), immutable document versions, tasks, lawyer-confirmed deadlines, daily plan |
  | `sources.ts` | Source registry with rights gate, versioned ingestion, hybrid search (full-text + vector) with scope/rights filters applied *before* ranking |
  | `ai/gateway.ts` | Single AI gateway: quota metering, idempotency, fault simulation, refusal of external actions |
  | `research.ts` | Claim composition plus an independent citation checker that fails closed |
  | `drafts.ts`, `word.ts` | Drafting, versions, review/approval hash, neutral comparison, `.docx` export with a DRAFT banner and source annex |
  | `dna.ts` | Writing/Reasoning DNA: separate consent, authorized samples, explainable traits, versioned profiles, feedback proposals with accept/reject/undo |
  | `audit.ts` | Append-only audit log, enforced by a database trigger |

- **AI adapter:** `local-extractive-v1`. It is deterministic and builds every proposition only from retrieved, rights-cleared passages. No external model provider is wired in, because DEV-206/207 (provider and data terms) are pending.
  - The gateway interface is the single place a real provider would plug in.
- **Embeddings:** `local-hash-v1`, a placeholder feature-hash vector with 256 dimensions. It is not semantic quality.
- **Online-first PWA:**
  - `public/sw.js` caches only the public static shell and `/offline`.
  - It never caches `/app`, `/api` or downloads, so there is no confidential offline cache (DEV-106).

## What "Verified" means

A claim is labelled **Verified source** only if all of these hold:
- its citation resolves to a passage the user is authorized to see;
- the quoted text is an exact substring of that passage;
- the source rights permit AI use and display;
- term overlap with the claim is adequate;
- the source is not stale, superseded or of unknown effective date.

Otherwise the claim is **Needs checking** (with reasons) or **Unverified**, for example when a citation is fabricated or missing. "Verified" is passage support, never a judgment of legal correctness.

## Framework traceability (summary)

| Requirement | Where |
|---|---|
| FR-001–004 accounts, tenants, roles, matter access | `accounts.ts`, `authz.ts`, `/app/team`, matter Team tab |
| FR-005 matters, facts, documents | `matters.ts`, `/app/matters/*` |
| FR-006/007/009 source registry, rights, ingestion, status warnings | `sources.ts`, `/app/library/*` |
| FR-008/010 research with cited passages, verification labels | `research.ts`, `/app/research/*`, `/app/chat` |
| FR-011–015 drafting, editor, versions, approval, Word export | `drafts.ts`, `word.ts`, `/app/drafts/*` |
| FR-016–018 tasks, deadlines (lawyer-confirmed only), reminders, daily plan | `tasks.ts`, `/app/tasks` |
| FR-019 AI gateway, quota, outage/partial recovery | `ai/gateway.ts`, `/app/account` |
| FR-020 PWA-ready, online-first | `public/sw.js`, `/offline` |
| FR-021–023 audit, export, policies/onboarding | `audit.ts`, matter export route, `/onboarding`, `/legal/*` |
| FR-024 quality scorecard (raw counts, no targets) | `scorecard.ts`, `/app/account?tab=scorecard` |
| FR-030–036 Lawyer DNA | `dna.ts`, `/app/dna` |
| FR-037–042 Work Desk (Rev 03) | `catalog.ts`, `workdesk.ts`, `/app`, `/app/continue`, `/app/start/*` |
| FD 07 test cases TC-001…038 | `tests/*.test.ts` (each test name cites its TC) |

## Pending decisions — placeholders in this build

These are **not decided**. The code marks each one and does not invent a value.

- **DEV-201 / DEV-204** (hosting, region, database): local embedded PGlite.
- **DEV-205** (authentication and MFA design): email + password with scrypt and server sessions. No MFA. Email delivery is replaced by on-screen development links.
- **DEV-206 / DEV-207** (AI provider and data terms): deterministic local adapter only.
- **DEV-208** (minimum DNA sample count): fewer than 3 samples caps trait confidence at "low".
- **DEV-209 / DEV-105** (quality targets): the scorecard shows raw counts with no targets.
- **DEV-101** (source rights): every legal source is a fictional TEST FIXTURE. No real source has been cleared.
- **Pricing and billing:** plan names and placeholder unit caps only, with no prices. No payment provider; nothing is charged.
- **Retention and deletion periods:** not set. Withdrawals stop use immediately; deletion is logged as pending policy.
- **Policies** (terms, privacy, AI disclosure, DNA notice): `0.1-draft`, marked "pending legal review".
- **Notifications** (email or calendar reminder delivery): in-app only.
- **Proposed Work Desk endpoints** `/v1/tasks`, `/v1/work`, `/v1/tasks/match` (FD 05 §3, Rev 03): proposed contracts, not built; the screens call the domain functions directly.

## Known limitations

- The extractive adapter produces short, quote-anchored propositions, not fluent legal prose.
- PDF text extraction is not implemented. PDFs are stored and versioned, but they are not ingested or analyzed.
- The embedded database is single-process. It is fine for a local pilot demo but not for multi-instance hosting.
- Fault simulation (`/app/account`, admin only) and the dev links exist only when `LEXIA_ENV` is not `production`.
