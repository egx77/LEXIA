/** Typed domain errors mapped to safe user-facing messages (FD 03 §8). */
export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found_or_denied'
  | 'invalid_input'
  | 'conflict'
  | 'rights_blocked'
  | 'consent_required'
  | 'ai_unavailable'
  | 'quota_exhausted'
  | 'approval_invalid';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found_or_denied: 404,
  invalid_input: 400,
  conflict: 409,
  rights_blocked: 422,
  consent_required: 422,
  ai_unavailable: 503,
  quota_exhausted: 402,
  approval_invalid: 409,
};

export class DomainError extends Error {
  status: number;
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.status = STATUS[code];
  }
}

export const MATTER_DENIED = 'You do not have access to this matter.';
