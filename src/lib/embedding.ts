/**
 * PLACEHOLDER embedding: deterministic feature hashing ("local-hash-v1").
 * It is NOT a semantic model. DEV-102/DEV-207 require benchmarking real embedding
 * models on a rights-cleared Philippine test set before selection. Kept local so search
 * keeps working when any AI provider is unavailable.
 */
export const EMBEDDING_MODEL = 'local-hash-v1';
export const DIM = 256;

export const STOP = new Set('the a an of to and or in on for by with is are was were be been this that which as at from it its shall may not no any such whether what when where how can could does did should would will after before under'.split(' '));

export function tokens(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map((t) => t.replace(/(ing|ed|es|s)$/, ''));
}

function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function embed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  const tk = tokens(text);
  const feats = [...tk, ...tk.slice(1).map((t, i) => tk[i] + '_' + t)];
  for (const f of feats) {
    const h = fnv(f);
    v[h % DIM] += (h & 0x80000000) ? -1 : 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => +(x / norm).toFixed(6));
}

export function toPgVector(v: number[]) {
  return `[${v.join(',')}]`;
}

/** Token-overlap relevance used by the independent citation checker. */
export function overlap(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n / Math.min(ta.size, tb.size);
}
