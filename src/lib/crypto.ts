import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return ['scrypt', salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const key = Buffer.from(keyB64, 'base64');
  const got = await scrypt(pw, Buffer.from(saltB64, 'base64'), key.length);
  return timingSafeEqual(key, got);
}

/** Stable JSON for hashing exact content versions (approval hashes). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}
