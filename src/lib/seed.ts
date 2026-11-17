import type { PGlite } from '@electric-sql/pglite';

/** Baseline reference data needed by every environment: unpriced plan placeholders and draft policy shells. */
export async function ensureBaseline(db: PGlite) {
  // B-02 / DEV-104: plan names and placeholder AI allowances only — no prices, no processor.
  const plans: [string, string, string, number][] = [
    ['pilot', 'Pilot', 'For consenting pilot participants. No charge is configured.', 500],
    ['solo', 'Solo practitioner', 'One lawyer with assistant seats. Pricing not set.', 1000],
    ['firm', 'Small firm', 'Multiple lawyers, assistants and admins. Pricing not set.', 3000],
    ['enterprise', 'Enterprise', 'Custom terms after review. Pricing not set.', 10000],
  ];
  for (const p of plans) {
    await db.query(`insert into plans(code, name, summary, placeholder_ai_units) values ($1,$2,$3,$4) on conflict (code) do nothing`, p);
  }
  const policies: [string, string][] = [
    ['terms', 'Terms of Service'],
    ['privacy', 'Privacy Notice'],
    ['ai_disclosure', 'AI Limitations Disclosure'],
    ['subscription', 'Subscription and Cancellation Policy'],
    ['dna_notice', 'Lawyer DNA Consent Notice'],
  ];
  for (const [kind, name] of policies) {
    await db.query(
      `insert into policy_documents(kind, version, body) values ($1, '0.1-draft', $2) on conflict (kind, version) do nothing`,
      [kind, `${name} — DRAFT PLACEHOLDER pending responsible legal review (FR-023). This text is not approved legal language and must not be relied on. Topics the reviewed policy must address are listed in the LEXIA framework (FD 02 §8, FD 03 §13, FD 04 §8).`],
    );
  }
}
