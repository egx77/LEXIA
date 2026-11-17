import type { PGlite } from '@electric-sql/pglite';

export interface Manifest { format: string; created_at: string; schema_version: string | null; sha256: string; bytes: number; counts: Record<string, number> }
export interface Step { name: string; ok: boolean; detail?: string | string[] }
export interface Report { verified_at: string; backup_created_at: string; steps: Step[]; ok: boolean }
export interface Check { check: string; violations: number }

export function sha256(buf: Uint8Array): string;
export function tableCounts(db: PGlite): Promise<Record<string, number>>;
export function integrityChecks(db: PGlite): Promise<Check[]>;
export function createBackup(db: PGlite): Promise<{ bytes: Buffer; manifest: Manifest }>;
export function openFromBackup(bytes: Uint8Array, dataDir?: string): Promise<PGlite>;
export function verifyBackup(bytes: Uint8Array, manifest: Manifest, dataDir?: string): Promise<Report>;
export function serverHoldsLock(dataDir: string): number | null;
