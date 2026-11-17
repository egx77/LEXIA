import { beforeAll, describe, expect, it } from 'vitest';
import { can } from '@/lib/authz';
import { getTask, guessChoice, matchTasks, TASKS, visibleTasks, wantsContinue } from '@/lib/catalog';
import { generateDraft } from '@/lib/drafts';
import { listMatters } from '@/lib/matters';
import { createTask } from '@/lib/tasks';
import { attention, continueItems, matchWork } from '@/lib/workdesk';
import { as, ASSISTANT, BILLING, CRUZ, freshFixtures, LIM, REYES } from './helpers';

beforeAll(freshFixtures);

describe('Work Desk — task catalog', () => {
  it('TC-031 never lets a "coming later" task be started and keeps ids unique', () => {
    expect(TASKS.filter((t) => t.availability === 'later' && t.href)).toEqual([]);
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length);
    expect(TASKS.filter((t) => t.availability !== 'later' && !t.note && t.availability === 'partial')).toEqual([]);
  });

  it('TC-032 matches plain-language instructions to the right task', () => {
    expect(matchTasks('Prepare a demand letter for my client regarding an unpaid loan of ₱500,000')[0].task.id).toBe('write-letter');
    expect(matchTasks('What are my hearings and deadlines this week?')[0].task.id).toBe('check-schedule');
    expect(matchTasks('Draft a complaint using my usual writing style')[0].task.id).toBe('write-pleading');
    expect(matchTasks('xyzzy plugh')).toEqual([]);
  });

  it('TC-033 reports a requested template honestly instead of substituting another', () => {
    const p = getTask('write-pleading')!;
    expect(guessChoice(p, 'Draft an answer with counterclaim')).toMatchObject({ value: 'answer', ready: true });
    expect(guessChoice(p, 'Draft a motion for reconsideration')).toMatchObject({ value: 'motion', ready: false });
    expect(guessChoice(getTask('write-letter')!, 'demand letter for unpaid rent')).toMatchObject({ value: 'demand_letter' });
  });

  it('TC-034 detects "continue" intent', () => {
    expect(wantsContinue('LEXIA, continue working on my motion for reconsideration yesterday')).toBe(true);
    expect(wantsContinue('Draft a new complaint')).toBe(false);
  });

  it('TC-035 filters runnable tasks by role (deny-by-default)', async () => {
    const assistant = await as(ASSISTANT);
    const ids = visibleTasks((p) => can(assistant, p)).map((t) => t.id);
    expect(ids).toContain('write-pleading');
    expect(ids).not.toContain('update-dna');
    expect(ids).not.toContain('open-case');
    const billing = await as(BILLING);
    expect(visibleTasks((p) => can(billing, p)).filter((t) => t.availability !== 'later')).toEqual([]);
  });
});

describe('Work Desk — continue work and attention are scoped', () => {
  it('TC-036 shows only work from assigned matters in the user’s own firm', async () => {
    const reyes = await as(REYES), cruz = await as(CRUZ), lim = await as(LIM);
    const [m] = await listMatters(reyes);
    await generateDraft(reyes, { matterId: m.id, docType: 'complaint', dnaMode: 'neutral' });
    const r = await continueItems(reyes), c = await continueItems(cruz), l = await continueItems(lim);
    expect(r.some((i) => i.kind === 'draft' && i.matterId === m.id)).toBe(true);
    expect(r.some((i) => /Ramos/.test(i.title))).toBe(false); // Cruz-only matter
    expect(c.some((i) => /Ramos/.test(i.title))).toBe(true);
    expect(l.some((i) => i.matterId === m.id || /Santos/.test(i.title))).toBe(false); // other firm
    expect(matchWork('continue my complaint for Santos', r)[0]?.item.kind).toBe('draft');
  });

  it('TC-037 only lawyers see drafts awaiting their approval; billing staff see no matter work', async () => {
    const reyes = await as(REYES), assistant = await as(ASSISTANT), billing = await as(BILLING);
    const a = await attention(reyes);
    expect(a.deadlines.every((d) => d.matter_title)).toBe(true);
    expect((await attention(assistant)).toApprove).toEqual([]);
    expect(await attention(billing)).toEqual({ deadlines: [], unverified: [], toApprove: [], unfinished: [] });
    expect(await continueItems(billing)).toEqual([]);
  });

  it('TC-038 a task can only be assigned to someone already on the matter', async () => {
    const reyes = await as(REYES), lim = await as(LIM);
    const [m] = await listMatters(reyes);
    await expect(createTask(reyes, m.id, { title: 'Delegated', kind: 'task', ownerId: lim.userId })).rejects.toThrow(/assigned to this matter/);
    const assistant = await as(ASSISTANT);
    await expect(createTask(reyes, m.id, { title: 'Prepare exhibits', kind: 'task', ownerId: assistant.userId })).resolves.toBeTruthy();
  });
});
