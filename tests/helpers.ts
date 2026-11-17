import { resolveSession, signIn } from '@/lib/accounts';
import type { Ctx } from '@/lib/authz';
import { resetDbForTests } from '@/lib/db';
import { ensureFixtures, FIXTURE_PASSWORD } from '@/lib/fixtures';

/** Fresh in-memory DB with the FD 07 §6 synthetic fixtures. */
export async function freshFixtures() {
  await resetDbForTests();
  process.env.LEXIA_SEED_FIXTURES = 'true';
  await ensureFixtures();
}

export async function as(email: string): Promise<Ctx> {
  const token = await signIn(email, FIXTURE_PASSWORD);
  const ctx = await resolveSession(token);
  if (!ctx) throw new Error('no session');
  return ctx;
}

export const REYES = 'atty.reyes@lexia.test';
export const CRUZ = 'atty.cruz@lexia.test';
export const ASSISTANT = 'assistant.dela@lexia.test';
export const BILLING = 'billing@lexia.test';
export const LIM = 'atty.lim@lexia.test';
export const QA = 'qa@lexia.test';
