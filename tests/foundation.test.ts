import { beforeAll, describe, expect, it } from 'vitest';
import { inviteMember, acceptInvitation, registerAccount, resolveSession, revokeMember, signIn, verifyEmail, listMembers } from '@/lib/accounts';
import { q } from '@/lib/db';
import { createMatter, getMatter, listMatters, updateMatter, uploadDocument, listDocumentVersions, readDocumentVersion } from '@/lib/matters';
import { confirmDeadline, createTask, listTasks, upcomingReminders } from '@/lib/tasks';
import { as, ASSISTANT, BILLING, CRUZ, freshFixtures, LIM, REYES } from './helpers';

beforeAll(freshFixtures);

describe('TC-001 registration / isolation (FR-001)', () => {
  it('rejects invalid input and duplicates, requires verification', async () => {
    await expect(registerAccount({ name: 'X', email: 'bad', password: 'longenoughpass', firmName: 'F' })).rejects.toThrow(/valid email/);
    await expect(registerAccount({ name: 'X', email: 'new@lexia.test', password: 'short', firmName: 'F' })).rejects.toThrow(/12 characters/);
    const r = await registerAccount({ name: 'New Lawyer', email: 'New@Lexia.test', password: 'a-very-long-password', firmName: 'New Firm' });
    await expect(registerAccount({ name: 'X', email: 'new@lexia.test', password: 'a-very-long-password', firmName: 'F' })).rejects.toThrow(/could not be created/);
    await expect(signIn('new@lexia.test', 'a-very-long-password')).rejects.toThrow(/Verify your email/);
    await verifyEmail(r.verifyToken);
    const ctx = await resolveSession(await signIn('new@lexia.test', 'a-very-long-password'));
    expect(ctx?.roles).toEqual(['firm_admin', 'lawyer']);
    expect(await listMatters(ctx!)).toEqual([]); // sees only own tenant: nothing
  });
});

describe('TC-002 grant and revoke (FR-002)', () => {
  it('revoked user loses access and sessions; cross-firm denied', async () => {
    const admin = await as(REYES);
    const token = await inviteMember(admin, 'temp@lexia.test', ['legal_assistant']);
    await acceptInvitation(token, { name: 'Temp', password: 'temporary-password-1' });
    const tempToken = await signIn('temp@lexia.test', 'temporary-password-1');
    const temp = (await resolveSession(tempToken))!;
    const [matter] = await listMatters(admin);
    const { grantMatter } = await import('@/lib/matters');
    await grantMatter(admin, matter.id, temp.userId);
    expect((await getMatter(temp, matter.id)).id).toBe(matter.id);
    await revokeMember(admin, temp.userId);
    expect(await resolveSession(tempToken)).toBeNull();
    const members = await listMembers(admin);
    expect(members.find((m) => m.user_id === temp.userId)?.status).toBe('revoked');
    const lim = await as(LIM);
    await expect(getMatter(lim, matter.id)).rejects.toThrow('You do not have access to this matter.');
    const denied = await q(`select 1 from audit_events where actor_id = $1 and action = 'matter.access' and outcome = 'denied'`, [lim.userId]);
    expect(denied.length).toBeGreaterThan(0);
  });

  it('non-admins cannot invite; billing staff has no matter access', async () => {
    await expect(inviteMember(await as(CRUZ), 'x@lexia.test', ['lawyer'])).rejects.toThrow(/role does not permit/);
    expect(await listMatters(await as(BILLING))).toEqual([]);
  });
});

describe('TC-003 matter records (FR-003)', () => {
  it('create/edit/archive with optimistic concurrency and history', async () => {
    const ctx = await as(CRUZ);
    const { matter_id, version } = await createMatter(ctx, { clientName: 'Test Client', title: 'Test matter' });
    const v2 = await updateMatter(ctx, matter_id, version, { title: 'Renamed matter' });
    await expect(updateMatter(ctx, matter_id, version, { title: 'Stale write' })).rejects.toThrow(/changed by someone else/);
    await updateMatter(ctx, matter_id, v2, { status: 'archived' });
    expect((await getMatter(ctx, matter_id)).status).toBe('archived');
    const hist = await q(`select action from audit_events where target_id = $1 order by id`, [matter_id]);
    expect(hist.map((h) => (h as { action: string }).action)).toEqual(['matter.create', 'matter.update', 'matter.update']);
  });

  it('firm admin without assignment cannot open another lawyer’s matter', async () => {
    const reyes = await as(REYES);
    const cruzMatters = await listMatters(await as(CRUZ));
    const ramos = cruzMatters.find((m) => m.title.startsWith('Ramos'))!;
    await expect(getMatter(reyes, ramos.id)).rejects.toThrow('You do not have access to this matter.');
  });
});

describe('TC-004 document repository (FR-004)', () => {
  it('keeps immutable versions with hashes and denies unassigned users', async () => {
    const ctx = await as(REYES);
    const [m] = (await listMatters(ctx)).filter((x) => x.title.startsWith('Marina'));
    const enc = new TextEncoder();
    await expect(uploadDocument(ctx, m.id, { filename: 'a.txt', bytes: enc.encode('hello'), rightsAttested: false })).rejects.toThrow(/authorized/);
    await expect(uploadDocument(ctx, m.id, { filename: 'a.exe', bytes: enc.encode('MZ'), rightsAttested: true })).rejects.toThrow(/Unsupported/);
    await expect(uploadDocument(ctx, m.id, { filename: 'fake.pdf', bytes: enc.encode('not a pdf'), rightsAttested: true })).rejects.toThrow(/does not match/);
    const v1 = await uploadDocument(ctx, m.id, { filename: 'note.txt', bytes: enc.encode('version one'), rightsAttested: true });
    const v2 = await uploadDocument(ctx, m.id, { filename: 'note.txt', bytes: enc.encode('version two'), rightsAttested: true, documentId: v1.documentId });
    expect(v2.version).toBe(2);
    const versions = await listDocumentVersions(ctx, m.id, v1.documentId);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(new TextDecoder().decode((await readDocumentVersion(ctx, v1.versionId)).bytes)).toBe('version one');
    await expect(readDocumentVersion(await as(LIM), v1.versionId)).rejects.toThrow();
  });
});

describe('TC-005 tasks/deadlines (FR-005, AC-007)', () => {
  it('suggested deadlines stay unverified until a lawyer confirms; assistants cannot confirm', async () => {
    const assistant = await as(ASSISTANT);
    const tasks = await listTasks(assistant);
    const suggested = tasks.find((t) => t.origin === 'suggested')!;
    expect(suggested.verification_status).toBe('unverified');
    expect(suggested.due_at).toBeNull(); // LEXIA never computes a statutory date
    await expect(confirmDeadline(assistant, suggested.id, { dueLocal: '2026-12-01', evidenceNote: 'x' })).rejects.toThrow(/role does not permit/);
    await expect(createTask(assistant, suggested.matter_id, { title: 'x', kind: 'deadline', dueLocal: '2026-12-01', verifiedByMe: true, evidenceNote: 'n' })).rejects.toThrow(/Only a lawyer/);
    const reyes = await as(REYES);
    await expect(confirmDeadline(reyes, suggested.id, { dueLocal: '2026-12-01', evidenceNote: '' })).rejects.toThrow(/basis/);
    await confirmDeadline(reyes, suggested.id, { dueLocal: '2026-12-01', evidenceNote: 'Checked fictional order' });
    await confirmDeadline(reyes, suggested.id, { dueLocal: '2026-12-01', evidenceNote: 'Re-confirmed' });
    const rem = await q(`select remind_on from reminders where task_id = $1`, [suggested.id]);
    expect(rem.length).toBe(2); // no duplicate reminders after re-confirming
    expect(Array.isArray(await upcomingReminders(reyes))).toBe(true);
  });
});

describe('TC-022 audit is append-only (FR-022)', () => {
  it('rejects updates and deletes on audit events', async () => {
    await expect(q(`update audit_events set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from audit_events`)).rejects.toThrow(/append-only/);
  });
});
