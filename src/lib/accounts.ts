import { audit } from './audit';
import { ROLES, requirePerm, type Ctx, type Role } from './authz';
import { hashPassword, newToken, sha256, verifyPassword } from './crypto';
import { one, q, tx } from './db';
import { DomainError } from './errors';

/** FR-001 / FR-002. DEV-205 (MFA, session lifetime, reauth) pending — values below are prototype defaults. */
export const SESSION_HOURS = 12;
/**
 * Sign-in throttling — prototype defaults pending DEV-205 (authentication design), not approved values.
 * After MAX_FAILURES wrong passwords within WINDOW_MIN minutes the email is locked for LOCK_MIN minutes.
 * Applied to every email, registered or not, with the same message, so it cannot reveal accounts.
 */
export const THROTTLE = { MAX_FAILURES: 5, WINDOW_MIN: 15, LOCK_MIN: 15 } as const;
const LOCKED_MSG = `Too many sign-in attempts. Try again in ${THROTTLE.LOCK_MIN} minutes, or reset your password.`;
const throttleKey = (email: string) => sha256(`signin:${email}`);

async function assertNotLocked(email: string) {
  const row = await one<{ locked: boolean }>(`select locked_until > now() as locked from auth_throttle where key_hash = $1`, [throttleKey(email)]);
  if (row?.locked) throw new DomainError('rate_limited', LOCKED_MSG);
}

/** Records a failure; returns true when this failure triggered a lock. */
async function recordFailure(email: string): Promise<boolean> {
  const row = (await one<{ failures: number }>(
    `insert into auth_throttle(key_hash, failures, window_started_at) values ($1, 1, now())
     on conflict (key_hash) do update set
       failures = case when auth_throttle.window_started_at < now() - make_interval(mins => $2) then 1 else auth_throttle.failures + 1 end,
       window_started_at = case when auth_throttle.window_started_at < now() - make_interval(mins => $2) then now() else auth_throttle.window_started_at end
     returning failures`, [throttleKey(email), THROTTLE.WINDOW_MIN]))!;
  if (row.failures < THROTTLE.MAX_FAILURES) return false;
  await q(`update auth_throttle set locked_until = now() + make_interval(mins => $2), failures = 0, window_started_at = now() where key_hash = $1`,
    [throttleKey(email), THROTTLE.LOCK_MIN]);
  return true;
}

async function clearThrottle(email: string) {
  await q(`delete from auth_throttle where key_hash = $1`, [throttleKey(email)]);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normEmail(e: string) {
  return e.trim().toLowerCase();
}

function validatePassword(pw: string) {
  if (pw.length < 12) throw new DomainError('invalid_input', 'Password must be at least 12 characters.');
}

export interface RegisterInput { name: string; email: string; password: string; firmName: string }

export async function registerAccount(input: RegisterInput) {
  const email = normEmail(input.email);
  const name = input.name.trim();
  const firmName = input.firmName.trim();
  if (!name || !firmName) throw new DomainError('invalid_input', 'Name and firm name are required.');
  if (!EMAIL_RE.test(email)) throw new DomainError('invalid_input', 'Enter a valid email address.');
  validatePassword(input.password);
  const pwHash = await hashPassword(input.password);
  const verifyToken = newToken();

  return tx(async (t) => {
    const exists = await one(`select 1 from users where lower(email) = $1`, [email], t);
    // Same message whether or not the email exists, to avoid account enumeration.
    if (exists) throw new DomainError('conflict', 'An account could not be created with these details. If you already registered, sign in or reset your password.');
    const tenant = (await one<{ id: string }>(`insert into tenants(name) values ($1) returning id`, [firmName], t))!;
    const user = (await one<{ id: string }>(
      `insert into users(email, name, password_hash) values ($1,$2,$3) returning id`, [email, name, pwHash], t))!;
    await q(`insert into memberships(tenant_id, user_id, roles) values ($1,$2,$3)`,
      [tenant.id, user.id, ['firm_admin', 'lawyer']], t);
    await q(`insert into entitlements(tenant_id, plan_code, ai_units_quota)
             select $1, code, placeholder_ai_units from plans where code = 'pilot'`, [tenant.id], t);
    await q(`insert into auth_tokens(token_hash, user_id, purpose, expires_at)
             values ($1,$2,'verify_email', now() + interval '2 days')`, [sha256(verifyToken), user.id], t);
    await audit({ tenantId: tenant.id, actorId: user.id, action: 'account.register', targetType: 'user', targetId: user.id }, t);
    return { userId: user.id, tenantId: tenant.id, verifyToken };
  });
}

export async function verifyEmail(token: string) {
  return tx(async (t) => {
    const row = await one<{ user_id: string }>(
      `update auth_tokens set used_at = now()
        where token_hash = $1 and purpose = 'verify_email' and used_at is null and expires_at > now()
        returning user_id`, [sha256(token)], t);
    if (!row) throw new DomainError('invalid_input', 'This verification link is invalid or has expired.');
    await q(`update users set email_verified_at = now() where id = $1`, [row.user_id], t);
    await audit({ actorId: row.user_id, action: 'account.verify_email', targetType: 'user', targetId: row.user_id }, t);
    return row.user_id;
  });
}

export async function signIn(emailIn: string, password: string): Promise<string> {
  const email = normEmail(emailIn);
  await assertNotLocked(email);
  const user = await one<{ id: string; password_hash: string; email_verified_at: Date | null }>(
    `select id, password_hash, email_verified_at from users where lower(email) = $1`, [email]);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok) {
    const locked = await recordFailure(email);
    await audit({ actorId: user?.id ?? null, action: locked ? 'auth.sign_in_locked' : 'auth.sign_in', outcome: 'denied' });
    if (locked) throw new DomainError('rate_limited', LOCKED_MSG);
    throw new DomainError('unauthenticated', 'Email or password is incorrect.');
  }
  await clearThrottle(email);
  if (!user.email_verified_at) throw new DomainError('forbidden', 'Verify your email address before signing in.');
  const m = await one<{ tenant_id: string }>(
    `select tenant_id from memberships where user_id = $1 and status = 'active' order by created_at limit 1`, [user.id]);
  if (!m) throw new DomainError('forbidden', 'Your account has no active firm membership.');
  const token = newToken();
  await q(`insert into sessions(token_hash, user_id, tenant_id, expires_at)
           values ($1,$2,$3, now() + make_interval(hours => $4))`, [sha256(token), user.id, m.tenant_id, SESSION_HOURS]);
  await audit({ tenantId: m.tenant_id, actorId: user.id, action: 'auth.sign_in' });
  return token;
}

export async function signOut(token: string) {
  await q(`update sessions set revoked_at = now() where token_hash = $1`, [sha256(token)]);
}

export async function resolveSession(token: string | undefined): Promise<Ctx | null> {
  if (!token) return null;
  const row = await one<{ user_id: string; name: string; email: string; tenant_id: string; tenant_name: string;
    tenant_kind: 'firm' | 'platform'; roles: Role[] }>(
    `select s.user_id, u.name, u.email, s.tenant_id, t.name as tenant_name, t.kind as tenant_kind, m.roles
       from sessions s
       join users u on u.id = s.user_id
       join memberships m on m.user_id = s.user_id and m.tenant_id = s.tenant_id and m.status = 'active'
       join tenants t on t.id = s.tenant_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`, [sha256(token)]);
  if (!row) return null;
  return { userId: row.user_id, name: row.name, email: row.email, tenantId: row.tenant_id,
    tenantName: row.tenant_name, tenantKind: row.tenant_kind, roles: row.roles };
}

export async function listMyTenants(userId: string) {
  return q<{ tenant_id: string; name: string; roles: Role[] }>(
    `select m.tenant_id, t.name, m.roles from memberships m join tenants t on t.id = m.tenant_id
      where m.user_id = $1 and m.status = 'active' order by t.name`, [userId]);
}

export async function switchTenant(token: string, userId: string, tenantId: string) {
  const m = await one(`select 1 from memberships where user_id = $1 and tenant_id = $2 and status = 'active'`, [userId, tenantId]);
  if (!m) throw new DomainError('forbidden', 'You are not a member of that firm.');
  await q(`update sessions set tenant_id = $2 where token_hash = $1`, [sha256(token), tenantId]);
  await audit({ tenantId, actorId: userId, action: 'auth.switch_tenant' });
}

/** Returns a token for display in development only; production would email it (provider not approved). */
export async function requestPasswordReset(emailIn: string): Promise<string | null> {
  const user = await one<{ id: string }>(`select id from users where lower(email) = $1`, [normEmail(emailIn)]);
  if (!user) return null;
  const token = newToken();
  await q(`insert into auth_tokens(token_hash, user_id, purpose, expires_at)
           values ($1,$2,'reset_password', now() + interval '1 hour')`, [sha256(token), user.id]);
  await audit({ actorId: user.id, action: 'auth.password_reset_requested' });
  return token;
}

export async function resetPassword(token: string, newPassword: string) {
  validatePassword(newPassword);
  const pwHash = await hashPassword(newPassword);
  await tx(async (t) => {
    const row = await one<{ user_id: string }>(
      `update auth_tokens set used_at = now()
        where token_hash = $1 and purpose = 'reset_password' and used_at is null and expires_at > now()
        returning user_id`, [sha256(token)], t);
    if (!row) throw new DomainError('invalid_input', 'This reset link is invalid or has expired.');
    await q(`update users set password_hash = $2 where id = $1`, [row.user_id, pwHash], t);
    await q(`update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [row.user_id], t);
    const u = (await one<{ email: string }>(`select email from users where id = $1`, [row.user_id], t))!;
    await q(`delete from auth_throttle where key_hash = $1`, [throttleKey(normEmail(u.email))], t); // a reset unlocks sign-in
    await audit({ actorId: row.user_id, action: 'auth.password_reset' }, t);
  });
}

// ---- Team management (FR-002) ----

function cleanRoles(roles: string[]): Role[] {
  const out = roles.filter((r): r is Role => (ROLES as readonly string[]).includes(r) && r !== 'qa_editor');
  if (!out.length) throw new DomainError('invalid_input', 'Choose at least one role.');
  return [...new Set(out)];
}

export async function inviteMember(ctx: Ctx, emailIn: string, roles: string[]) {
  await requirePerm(ctx, 'manage_members');
  const email = normEmail(emailIn);
  if (!EMAIL_RE.test(email)) throw new DomainError('invalid_input', 'Enter a valid email address.');
  const r = cleanRoles(roles);
  const token = newToken();
  await q(`insert into invitations(tenant_id, email, roles, token_hash, invited_by, expires_at)
           values ($1,$2,$3,$4,$5, now() + interval '7 days')`, [ctx.tenantId, email, r, sha256(token), ctx.userId]);
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'member.invite', meta: { roles: r } });
  return token;
}

export async function getInvitation(token: string) {
  return one<{ id: string; tenant_id: string; tenant_name: string; email: string; roles: Role[] }>(
    `select i.id, i.tenant_id, t.name as tenant_name, i.email, i.roles from invitations i join tenants t on t.id = i.tenant_id
      where i.token_hash = $1 and i.accepted_at is null and i.expires_at > now()`, [sha256(token)]);
}

/** Accept an invitation; creates the user if new (email treated as verified by possession of the invite token). */
export async function acceptInvitation(token: string, input: { name: string; password: string }) {
  const inv = await getInvitation(token);
  if (!inv) throw new DomainError('invalid_input', 'This invitation is invalid or has expired.');
  return tx(async (t) => {
    let user = await one<{ id: string; password_hash: string }>(`select id, password_hash from users where lower(email) = $1`, [inv.email], t);
    if (user) {
      if (!(await verifyPassword(input.password, user.password_hash))) throw new DomainError('unauthenticated', 'Enter your existing LEXIA password to join this firm.');
    } else {
      validatePassword(input.password);
      if (!input.name.trim()) throw new DomainError('invalid_input', 'Name is required.');
      user = (await one<{ id: string; password_hash: string }>(
        `insert into users(email, name, password_hash, email_verified_at) values ($1,$2,$3, now()) returning id, password_hash`,
        [inv.email, input.name.trim(), await hashPassword(input.password)], t))!;
    }
    await q(`insert into memberships(tenant_id, user_id, roles) values ($1,$2,$3)
             on conflict (tenant_id, user_id) do update set roles = excluded.roles, status = 'active', revoked_at = null`,
    [inv.tenant_id, user.id, inv.roles], t);
    await q(`update invitations set accepted_at = now() where id = $1`, [inv.id], t);
    await audit({ tenantId: inv.tenant_id, actorId: user.id, action: 'member.join', meta: { roles: inv.roles } }, t);
    return user.id;
  });
}

export async function listMembers(ctx: Ctx) {
  return q<{ user_id: string; name: string; email: string; roles: Role[]; status: string }>(
    `select m.user_id, u.name, u.email, m.roles, m.status from memberships m join users u on u.id = m.user_id
      where m.tenant_id = $1 order by m.status, u.name`, [ctx.tenantId]);
}

export async function updateMemberRoles(ctx: Ctx, userId: string, roles: string[]) {
  await requirePerm(ctx, 'manage_members');
  const r = cleanRoles(roles);
  if (userId === ctx.userId && !r.includes('firm_admin')) throw new DomainError('invalid_input', 'You cannot remove your own admin role.');
  const row = await one(`update memberships set roles = $3 where tenant_id = $1 and user_id = $2 and status = 'active' returning 1`,
    [ctx.tenantId, userId, r]);
  if (!row) throw new DomainError('not_found_or_denied', 'Member not found.');
  await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'member.roles', targetType: 'user', targetId: userId, meta: { roles: r } });
}

/** Revoked users lose access immediately: membership, sessions in this firm and matter grants (TC-002). */
export async function revokeMember(ctx: Ctx, userId: string) {
  await requirePerm(ctx, 'manage_members');
  if (userId === ctx.userId) throw new DomainError('invalid_input', 'You cannot revoke your own membership.');
  await tx(async (t) => {
    const row = await one(`update memberships set status = 'revoked', revoked_at = now()
                            where tenant_id = $1 and user_id = $2 and status = 'active' returning 1`, [ctx.tenantId, userId], t);
    if (!row) throw new DomainError('not_found_or_denied', 'Member not found.');
    await q(`update sessions set revoked_at = now() where user_id = $1 and tenant_id = $2 and revoked_at is null`, [userId, ctx.tenantId], t);
    await q(`delete from matter_assignments where user_id = $1 and matter_id in (select id from matters where tenant_id = $2)`, [userId, ctx.tenantId], t);
    await audit({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'member.revoke', targetType: 'user', targetId: userId }, t);
  });
}
