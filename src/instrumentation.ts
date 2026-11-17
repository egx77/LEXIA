/** Runs once at server start: opens the DB (migrations + baseline) and seeds synthetic fixtures in non-production. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { ensureFixtures } = await import('./lib/fixtures');
  try {
    const seeded = await ensureFixtures();
    if (seeded) console.log('[lexia] Synthetic fixtures seeded (FD 07 §6). Sign in at /signin with a fixture account.');
  } catch (e) {
    console.error('[lexia] Fixture seeding failed:', e instanceof Error ? e.message : e);
  }
}
