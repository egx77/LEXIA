import type { Permission } from './authz';
import { tokens } from './embedding';

/**
 * LEXIA Work Desk — Legal Task Catalog. Framework Revision 03 (Amendment A-01): UX-103, FR-039, FR-041.
 *
 * DEV-211: a task becomes 'ready' only with an approved requirement, lawyer-reviewed template or rules, and
 * passing tests. DEV-212: matching stays deterministic until an AI provider is approved. DEV-213: no voice input.
 *
 * What the lawyer sees is a task; the workflow and modules behind it are invisible. Availability is honest:
 *  - ready:   works end to end in this build
 *  - partial: an existing capability covers part of it (the note says which part)
 *  - later:   not built; the framework does not yet define the rules or engine (never simulated)
 */
export type Availability = 'ready' | 'partial' | 'later';

export interface Choice { value: string; label: string; ready: boolean }
export interface TaskDef {
  id: string; cat: CategoryId; label: string; detail: string; availability: Availability;
  href?: string; note?: string; perm?: Permission; keywords: string[]; choices?: Choice[];
}

export const CATEGORIES = [
  { id: 'write', label: 'Write or draft', blurb: 'Pleadings, letters, memoranda and other documents' },
  { id: 'research', label: 'Research', blurb: 'Laws, decisions, regulations and legal questions' },
  { id: 'analyze', label: 'Analyze', blurb: 'Problems, cases, contracts, evidence and options' },
  { id: 'review', label: 'Review or improve', blurb: 'Check, proofread, restyle or verify a document' },
  { id: 'prepare', label: 'Prepare', blurb: 'Hearings, consultations, negotiations and filings' },
  { id: 'matter', label: 'Manage a matter', blurb: 'Cases, engagements, deadlines and chronology' },
  { id: 'notarial', label: 'Notarial work', blurb: 'Notarial documents and register' },
  { id: 'client', label: 'Work with a client', blurb: 'Intake, conflicts, updates and billing' },
  { id: 'practice', label: 'Manage my practice', blurb: 'Schedule, team, templates and Lawyer DNA' },
  { id: 'learn', label: 'Learn', blurb: 'Concepts, new laws and legal developments' },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]['id'];

const later = (cat: CategoryId, id: string, label: string, detail: string, keywords: string[] = []): TaskDef =>
  ({ id, cat, label, detail, availability: 'later', keywords });

export const PLEADING_CHOICES: Choice[] = [
  { value: 'complaint', label: 'Complaint', ready: true },
  { value: 'answer', label: 'Answer', ready: true },
  { value: 'position_paper', label: 'Position Paper', ready: true },
  { value: 'petition', label: 'Petition', ready: false },
  { value: 'motion', label: 'Motion', ready: false },
  { value: 'opposition', label: 'Opposition', ready: false },
  { value: 'reply', label: 'Reply', ready: false },
  { value: 'manifestation', label: 'Manifestation', ready: false },
];
export const LETTER_CHOICES: Choice[] = [
  { value: 'demand_letter', label: 'Demand letter', ready: true },
  { value: 'reply_letter', label: 'Reply', ready: false },
  { value: 'notice', label: 'Notice', ready: false },
  { value: 'advisory', label: 'Advisory', ready: false },
  { value: 'request', label: 'Request', ready: false },
  { value: 'endorsement', label: 'Endorsement', ready: false },
];

export const TASKS: TaskDef[] = [
  // A. Write or draft
  { id: 'write-pleading', cat: 'write', label: 'Write a pleading', detail: 'Complaint, Answer, Position Paper, Petition, Motion, Opposition, Reply, Manifestation',
    availability: 'partial', href: '/app/start/write-pleading', perm: 'draft', choices: PLEADING_CHOICES,
    note: 'Complaint, Answer and Position Paper are ready; other pleading templates come later.', keywords: ['pleading', 'complaint', 'answer', 'counterclaim', 'position paper', 'petition', 'motion', 'opposition', 'reply', 'manifestation', 'file', 'sue'] },
  { id: 'write-letter', cat: 'write', label: 'Write a letter', detail: 'Demand, Reply, Notice, Advisory, Request, Endorsement',
    availability: 'partial', href: '/app/start/write-letter', perm: 'draft', choices: LETTER_CHOICES,
    note: 'Demand letters are ready; other letter templates come later.', keywords: ['letter', 'demand', 'collection', 'unpaid', 'loan', 'notice', 'advisory'] },
  { id: 'write-memo', cat: 'write', label: 'Write a legal memorandum', detail: 'Research memorandum, case analysis, internal memorandum',
    availability: 'ready', href: '/app/start/write-memo', perm: 'draft', keywords: ['memorandum', 'memo', 'case analysis', 'internal'] },
  later('write', 'write-notarization', 'Draft a document for notarization', 'Affidavit, Special Power of Attorney, Deed, Undertaking, Certification', ['affidavit', 'spa', 'power of attorney', 'deed', 'undertaking']),
  later('write', 'write-contract', 'Draft a contract', 'Sale, Lease, Loan, Employment, Consultancy, Service, Partnership', ['contract', 'agreement', 'lease', 'sale', 'loan', 'employment']),
  { id: 'write-opinion', cat: 'write', label: 'Write a legal opinion', detail: 'Formal opinion, advisory, interpretation', availability: 'partial', href: '/app/start/write-memo', perm: 'draft',
    note: 'No opinion template yet. A legal memorandum with cited analysis is available now.', keywords: ['opinion', 'advisory', 'interpretation'] },
  later('write', 'write-judicial-affidavit', 'Draft a judicial affidavit', 'Witness testimony and supporting exhibits', ['judicial affidavit', 'witness', 'testimony']),
  later('write', 'write-corporate', 'Draft a corporate document', 'Board resolution, secretary’s certificate, minutes, bylaws', ['board resolution', 'secretary', 'certificate', 'minutes', 'bylaws', 'corporate']),
  later('write', 'write-settlement', 'Draft a settlement agreement', 'Compromise agreement, waiver, release, quitclaim', ['settlement', 'compromise', 'waiver', 'quitclaim', 'release']),
  later('write', 'write-estate', 'Draft an estate document', 'Will, extrajudicial settlement, partition', ['will', 'estate', 'extrajudicial', 'partition']),
  later('write', 'write-employment', 'Draft an employment document', 'Notice to explain, disciplinary notice, termination notice', ['notice to explain', 'disciplinary', 'termination']),
  later('write', 'write-appellate', 'Write an appellate submission', 'Appeal, brief, petition for review', ['appeal', 'appellate', 'brief', 'review']),
  later('write', 'write-policy', 'Draft a policy', 'Privacy policy, company policy, terms and conditions', ['policy', 'privacy', 'terms']),
  later('write', 'write-other', 'Write another document', 'Describe the document needed', ['document']),

  // B. Research
  { id: 'research-question', cat: 'research', label: 'Research a legal question', detail: 'Describe the question in ordinary language', availability: 'ready', href: '/app/research', perm: 'research',
    keywords: ['research', 'question', 'whether', 'legal issue', 'law on'] },
  { id: 'find-law', cat: 'research', label: 'Find a law', detail: 'Constitution, statute, code, special law', availability: 'ready', href: '/app/research?types=constitution,statute', perm: 'research',
    keywords: ['law', 'statute', 'code', 'constitution', 'article', 'provision'] },
  { id: 'find-jurisprudence', cat: 'research', label: 'Find jurisprudence', detail: 'Decisions by topic, doctrine, issue or citation', availability: 'ready', href: '/app/research?types=decision', perm: 'research',
    keywords: ['jurisprudence', 'decision', 'case', 'ruling', 'doctrine', 'supreme court'] },
  { id: 'find-regulation', cat: 'research', label: 'Find a regulation', detail: 'Circular, memorandum, administrative order', availability: 'ready', href: '/app/research?types=issuance,rule', perm: 'research',
    keywords: ['regulation', 'circular', 'administrative order', 'issuance', 'rule'] },
  { id: 'find-supporting', cat: 'research', label: 'Find supporting authorities', detail: 'Authorities supporting a proposed argument', availability: 'partial', href: '/app/research', perm: 'research',
    note: 'Research returns relevant cited passages; it does not yet sort them into supporting or adverse.', keywords: ['supporting', 'authorities', 'support', 'argument'] },
  later('research', 'find-adverse', 'Find adverse authorities', 'Authorities unfavorable to a proposed argument', ['adverse', 'unfavorable', 'against']),
  { id: 'verify-citation', cat: 'research', label: 'Verify a citation', detail: 'Case name, docket number, date, quotation', availability: 'partial', href: '/app/drafts', perm: 'draft',
    note: 'Every citation in LEXIA drafts and research is checked automatically. Checking a citation you paste in is not built yet.', keywords: ['verify', 'citation', 'cite', 'quotation', 'docket'] },
  { id: 'check-current', cat: 'research', label: 'Check whether a law is current', detail: 'Amendments, repeal, modifications', availability: 'partial', href: '/app/library', perm: 'research',
    note: 'The Legal Library shows superseded, stale and unknown-date warnings. Amendment and repeal tracking is not built.', keywords: ['current', 'amended', 'amendment', 'repealed', 'repeal', 'still valid'] },
  later('research', 'compare-decisions', 'Compare court decisions', 'Similarities, differences and applicability', ['compare', 'decisions']),
  later('research', 'summarize-case', 'Summarize a case', 'Facts, issues, ruling and doctrine', ['summarize', 'summary', 'digest']),
  later('research', 'research-procedure', 'Research procedural requirements', 'Filing, jurisdiction, venue, remedies', ['procedure', 'procedural', 'jurisdiction', 'venue', 'remedies', 'filing']),
  later('research', 'research-recent', 'Research recent legal developments', 'New laws, rulings and regulations', ['recent', 'new laws', 'developments']),

  // C. Analyze
  { id: 'analyze-problem', cat: 'analyze', label: 'Analyze a legal problem', detail: 'Apply relevant law to a factual situation', availability: 'partial', href: '/app/research', perm: 'research',
    note: 'Research analyzes each issue against permitted sources; facts you state are treated as unverified allegations.', keywords: ['analyze', 'analysis', 'problem', 'situation', 'facts'] },
  later('analyze', 'evaluate-case', 'Evaluate a potential case', 'Merits, weaknesses, remedies and risks', ['evaluate', 'merits', 'chances', 'weaknesses']),
  later('analyze', 'analyze-decision', 'Analyze a court decision', 'Findings, implications and available remedies', ['decision', 'implications']),
  later('analyze', 'analyze-contract', 'Analyze a contract', 'Risks, obligations and unfavorable clauses', ['contract', 'clauses', 'obligations']),
  later('analyze', 'analyze-evidence', 'Analyze evidence', 'Relevance, admissibility, sufficiency', ['evidence', 'admissibility']),
  later('analyze', 'identify-issues', 'Identify legal issues', 'Discover possible claims, defenses and obligations', ['issues', 'claims', 'defenses']),
  later('analyze', 'evaluate-argument', 'Evaluate an argument', 'Strength, weaknesses and legal support', ['argument', 'strength']),
  later('analyze', 'devils-advocate', 'Challenge my legal position', 'Devil’s Advocate', ['challenge', 'devil', 'advocate', 'counter']),
  later('analyze', 'compare-options', 'Compare legal options', 'Alternative strategies and consequences', ['options', 'strategies', 'alternatives']),
  later('analyze', 'assess-deadline', 'Assess a deadline', 'Applicable procedural rule and triggering event', ['compute', 'reglementary', 'period']),
  later('analyze', 'due-diligence', 'Conduct due diligence', 'Corporate, property, contract or regulatory', ['due diligence']),
  later('analyze', 'analyze-client', 'Analyze a client’s situation', 'Rights, obligations, risks and recommendations', ['rights', 'recommendations']),

  // D. Review or improve
  later('review', 'review-pleading', 'Review a pleading', 'Legal sufficiency, consistency and completeness', ['review pleading']),
  later('review', 'review-contract', 'Review a contract', 'Missing clauses, risks and ambiguities', ['review contract', 'lease agreement']),
  later('review', 'review-opinion', 'Review a legal opinion', 'Accuracy, reasoning and supporting authorities', ['review opinion']),
  later('review', 'review-letter', 'Review a letter', 'Tone, clarity and legal implications', ['review letter']),
  later('review', 'review-affidavit', 'Review an affidavit', 'Consistency and completeness', ['review affidavit']),
  later('review', 'review-notarization', 'Review a document for notarization', 'Formal requirements and completeness', ['notarization requirements']),
  later('review', 'proofread', 'Proofread a document', 'Grammar, spelling and formatting', ['proofread', 'grammar', 'spelling']),
  later('review', 'improve-arguments', 'Improve my arguments', 'Structure, persuasiveness and legal support', ['improve', 'persuasive']),
  { id: 'rewrite-style', cat: 'review', label: 'Rewrite in my style', detail: 'Apply Writing DNA', availability: 'partial', href: '/app/start/write-pleading', perm: 'dna',
    note: 'Writing DNA is applied when LEXIA drafts a new document. Restyling an existing document is not built.', keywords: ['style', 'my style', 'usual style', 'writing dna', 'rewrite'] },
  { id: 'reevaluate-approach', cat: 'review', label: 'Reevaluate using my approach', detail: 'Apply Reasoning DNA', availability: 'partial', href: '/app/start/write-memo', perm: 'dna',
    note: 'Reasoning DNA is applied when LEXIA drafts a new document. Re-analyzing an existing document is not built.', keywords: ['approach', 'reasoning dna', 'my approach'] },
  { id: 'compare-documents', cat: 'review', label: 'Compare two documents', detail: 'Differences, omissions and changes', availability: 'partial', href: '/app/drafts', perm: 'draft',
    note: 'You can compare draft versions and a personalized draft with its neutral version. Comparing two uploaded files is not built.', keywords: ['compare', 'differences', 'changes'] },
  { id: 'verify-all-citations', cat: 'review', label: 'Verify all legal citations', detail: 'Check authorities and supporting propositions', availability: 'ready', href: '/app/drafts', perm: 'draft',
    note: 'Open a LEXIA draft: every citation is re-checked on each save and open items are listed under “Needs checking”.', keywords: ['verify', 'citations', 'check authorities'] },

  // E. Prepare
  later('prepare', 'prep-consultation', 'Prepare for a client consultation', 'Questions, issues and documents needed', ['consultation']),
  later('prepare', 'prep-hearing', 'Prepare for a hearing', 'Case summary, arguments and checklist', ['hearing']),
  later('prepare', 'prep-pretrial', 'Prepare for pre-trial', 'Stipulations, witnesses, exhibits and issues', ['pre-trial', 'pretrial', 'stipulations']),
  later('prepare', 'prep-direct', 'Prepare for direct examination', 'Witness questions and evidence', ['direct examination']),
  later('prepare', 'prep-cross', 'Prepare for cross-examination', 'Questions, contradictions and impeachment issues', ['cross-examination', 'cross examination', 'impeachment']),
  later('prepare', 'prep-oral', 'Prepare for oral arguments', 'Arguments, authorities and anticipated questions', ['oral arguments']),
  later('prepare', 'prep-mediation', 'Prepare for mediation', 'Settlement objectives and alternatives', ['mediation']),
  later('prepare', 'prep-negotiation', 'Prepare for negotiation', 'Positions, concessions and risks', ['negotiation', 'negotiate']),
  later('prepare', 'prep-board', 'Prepare for a board meeting', 'Agenda, resolutions and legal issues', ['board meeting']),
  later('prepare', 'prep-filing', 'Prepare for filing', 'Document checklist and procedural requirements', ['filing checklist']),
  later('prepare', 'prep-transaction', 'Prepare for a transaction', 'Documents, due diligence and closing requirements', ['transaction', 'closing']),

  // F. Manage a matter
  { id: 'open-case', cat: 'matter', label: 'Open a new case', detail: 'Establish a litigation matter', availability: 'ready', href: '/app/matters/new', perm: 'create_matter',
    keywords: ['open case', 'new case', 'new matter', 'litigation'] },
  { id: 'open-engagement', cat: 'matter', label: 'Open a new legal engagement', detail: 'Establish a non-litigation matter', availability: 'ready', href: '/app/matters/new?kind=engagement', perm: 'create_matter',
    keywords: ['engagement', 'retainer', 'non-litigation'] },
  { id: 'update-case', cat: 'matter', label: 'Update a case', detail: 'Record developments and status', availability: 'ready', href: '/app/matters', perm: 'matter_work',
    keywords: ['update', 'developments', 'status'] },
  later('matter', 'case-strategy', 'Develop a case strategy', 'Objectives, arguments and actions', ['strategy']),
  { id: 'chronology', cat: 'matter', label: 'Create a case chronology', detail: 'Organize events and evidence', availability: 'partial', href: '/app/matters', perm: 'matter_work',
    note: 'Record dated facts in a matter’s Facts tab; a generated timeline view is not built.', keywords: ['chronology', 'timeline', 'events'] },
  { id: 'organize-evidence', cat: 'matter', label: 'Organize evidence', detail: 'Index documents and link to issues', availability: 'partial', href: '/app/matters', perm: 'matter_work',
    note: 'Upload versioned documents and link evidence facts to them; issue linking is not built.', keywords: ['evidence', 'exhibits', 'index'] },
  later('matter', 'add-witness', 'Add a witness', 'Record details and testimony', ['witness']),
  later('matter', 'record-hearing', 'Record a hearing', 'Results, orders and next steps', ['hearing result', 'order']),
  { id: 'set-deadline', cat: 'matter', label: 'Set a deadline', detail: 'Record and verify an obligation', availability: 'ready', href: '/app/start/set-deadline', perm: 'matter_work',
    keywords: ['deadline', 'due', 'reminder', 'set deadline'] },
  { id: 'assign-task', cat: 'matter', label: 'Assign a task', detail: 'Delegate work to an authorized team member', availability: 'ready', href: '/app/start/set-deadline?kind=task', perm: 'matter_work',
    keywords: ['assign', 'delegate', 'task'] },
  later('matter', 'status-report', 'Prepare a case status report', 'Summarize developments and next actions', ['status report']),
  { id: 'close-matter', cat: 'matter', label: 'Close a matter', detail: 'Record outcome and archive documents', availability: 'partial', href: '/app/matters', perm: 'matter_work',
    note: 'Set the matter status to Closed or Archived from its Overview tab; outcome recording is not built.', keywords: ['close', 'archive', 'outcome'] },

  // G. Notarial work (rules for notarial acts are not defined in the framework — not simulated)
  later('notarial', 'notarial-affidavit', 'Prepare an affidavit', 'Select affidavit type', ['affidavit']),
  later('notarial', 'notarial-spa', 'Prepare a Special Power of Attorney', 'Identify authorized acts', ['special power of attorney', 'spa']),
  later('notarial', 'notarial-deed', 'Prepare a deed', 'Sale, donation, assignment and others', ['deed', 'donation', 'assignment']),
  later('notarial', 'notarial-check', 'Check notarization requirements', 'Review document and applicable formalities', ['notarization', 'notarial requirements']),
  later('notarial', 'notarial-record', 'Record a notarial transaction', 'Enter details of an authorized notarial act', ['notarial register', 'notarial act']),
  later('notarial', 'notarial-search', 'Search my notarial register', 'Retrieve previous entries', ['notarial register']),
  later('notarial', 'notarial-report', 'Prepare a notarial report', 'Compile required records', ['notarial report']),
  later('notarial', 'notarial-commission', 'Monitor my notarial commission', 'Track validity and obligations', ['commission']),

  // H. Work with a client
  { id: 'register-client', cat: 'client', label: 'Register a new client', detail: 'Create client profile', availability: 'partial', href: '/app/matters/new', perm: 'create_matter',
    note: 'Clients are registered when you open their first matter; a separate client profile is not built.', keywords: ['client', 'register client', 'new client'] },
  later('client', 'conflict-check', 'Conduct a conflict check', 'Review parties and relationships', ['conflict', 'conflict check']),
  later('client', 'record-consultation', 'Record a consultation', 'Document facts and instructions', ['consultation notes']),
  later('client', 'engagement-letter', 'Prepare an engagement letter', 'Scope and fees', ['engagement letter', 'fees']),
  later('client', 'client-update', 'Send a client update', 'Prepare progress communication', ['client update', 'progress']),
  later('client', 'request-documents', 'Request documents', 'Identify outstanding requirements', ['request documents', 'requirements']),
  later('client', 'schedule-meeting', 'Schedule a meeting', 'Arrange consultation or follow-up', ['meeting', 'appointment', 'schedule meeting']),
  later('client', 'billing-statement', 'Prepare a billing statement', 'Fees and expenses', ['billing', 'statement', 'invoice']),
  later('client', 'record-payment', 'Record a payment', 'Update financial records', ['payment', 'paid']),

  // I. Manage my practice
  { id: 'check-schedule', cat: 'practice', label: 'Check my schedule', detail: 'Hearings, appointments and deadlines', availability: 'ready', href: '/app/tasks', perm: 'matter_work',
    keywords: ['schedule', 'calendar', 'hearings', 'deadlines', 'this week', 'today'] },
  { id: 'pending-tasks', cat: 'practice', label: 'Check my pending tasks', detail: 'Work requiring attention', availability: 'ready', href: '/app/tasks', perm: 'matter_work',
    keywords: ['pending', 'tasks', 'to do', 'follow-ups', 'attention'] },
  later('practice', 'finances', 'Review my finances', 'Income, expenses and receivables', ['finances', 'income', 'expenses', 'receivables']),
  { id: 'manage-team', cat: 'practice', label: 'Manage my team', detail: 'Assignments and workload', availability: 'partial', href: '/app/team', perm: 'manage_members',
    note: 'Invite members, set roles and revoke access; workload views are not built.', keywords: ['team', 'members', 'staff', 'workload'] },
  later('practice', 'compliance', 'Monitor my professional compliance', 'MCLE, IBP and other obligations', ['mcle', 'ibp', 'compliance']),
  { id: 'performance', cat: 'practice', label: 'Review my practice performance', detail: 'Productivity and financial indicators', availability: 'partial', href: '/app/account?tab=scorecard', perm: 'view_audit',
    note: 'A quality scorecard (citations, edits, approvals, AI usage) is available; financial indicators are not built.', keywords: ['performance', 'productivity', 'scorecard'] },
  later('practice', 'templates', 'Manage my templates', 'Approved documents and clauses', ['templates', 'clauses']),
  { id: 'update-dna', cat: 'practice', label: 'Update my Lawyer DNA', detail: 'Writing and reasoning preferences', availability: 'ready', href: '/app/dna', perm: 'dna',
    keywords: ['dna', 'lawyer dna', 'preferences', 'writing style', 'samples'] },
  { id: 'blind-review', cat: 'practice', label: 'Blind-review my drafts', detail: 'Pilot: does the DNA version sound like you? (FR-036)', availability: 'ready', href: '/app/dna?tab=blind', perm: 'dna',
    keywords: ['blind review', 'blind', 'recognition', 'sound like me', 'pilot review'] },
  later('practice', 'plan-practice', 'Plan my legal practice', 'Goals, strategies and resources', ['plan practice', 'goals']),

  // J. Learn
  { id: 'explain-concept', cat: 'learn', label: 'Explain a legal concept', detail: 'Plain-language or technical explanation', availability: 'partial', href: '/app/chat', perm: 'research',
    note: 'Ask LEXIA answers from permitted sources with citations; guided explanations are not built.', keywords: ['explain', 'concept', 'meaning', 'what is'] },
  { id: 'study-law', cat: 'learn', label: 'Study a new law', detail: 'Provisions and implications', availability: 'partial', href: '/app/library', perm: 'research',
    note: 'Read provisions in the Legal Library; guided study is not built.', keywords: ['study', 'new law'] },
  later('learn', 'understand-decision', 'Understand a court decision', 'Guided case analysis', ['understand decision']),
  later('learn', 'learn-area', 'Learn about a practice area', 'Structured legal learning', ['practice area', 'learn']),
  later('learn', 'test-knowledge', 'Test my legal knowledge', 'Questions and hypothetical cases', ['quiz', 'test my knowledge', 'hypothetical']),
  later('learn', 'learn-developments', 'Check recent legal developments', 'Personalized legal updates', ['updates', 'developments']),
];

export const AVAILABILITY_LABEL: Record<Availability, string> = { ready: 'Ready', partial: 'Partly available', later: 'Coming later' };

export function getTask(id: string) { return TASKS.find((t) => t.id === id); }

/** Tasks the user may start: permission-filtered (deny-by-default). Coming-later tasks are always shown, never runnable. */
export function visibleTasks(can: (p: Permission) => boolean, cat?: CategoryId) {
  return TASKS.filter((t) => (!cat || t.cat === cat) && (t.availability === 'later' || !t.perm || can(t.perm)));
}

// ---- Intent: "Tell LEXIA what you want to do" (deterministic keyword matching; the lawyer confirms before anything starts) ----

const DRAFT_VERB_RE = /\b(draft|write|prepare|compose)\b/;
const CONTINUE_RE = /\b(continue|resume|keep working|pick up|where i left|unfinished|yesterday|last time|my (draft|motion|memo|research))\b/i;

export function wantsContinue(text: string) { return CONTINUE_RE.test(text); }

export function scoreText(query: string, target: string): number {
  const q = new Set(tokens(query));
  if (!q.size) return 0;
  let s = 0;
  for (const t of new Set(tokens(target))) if (q.has(t)) s += 1;
  return s;
}

export function matchTasks(query: string, list: TaskDef[] = TASKS, limit = 5) {
  const lower = query.toLowerCase();
  return list
    .map((t) => {
      let score = scoreText(query, `${t.label} ${t.detail}`);
      for (const k of t.keywords) if (lower.includes(k)) score += k.includes(' ') ? 3 : 2;
      // Naming a specific document type ("a complaint", "a demand letter") is the strongest signal of the task.
      if (t.choices && guessChoice(t, query)) score += 4;
      if (t.cat === 'write' && DRAFT_VERB_RE.test(lower)) score += 1;
      if (t.availability === 'ready') score += 0.5; else if (t.availability === 'partial') score += 0.25;
      return { task: t, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The choice (e.g. "demand", "answer", "motion") mentioned in the instruction, ready or not. */
export function guessChoice(task: TaskDef, text: string): Choice | undefined {
  const lower = text.toLowerCase();
  return (task.choices ?? []).find((c) => new RegExp(`\\b${c.label.toLowerCase().replace(' letter', '')}\\b`).test(lower));
}
