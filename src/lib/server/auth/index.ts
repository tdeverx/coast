import { usernameSchema, passwordSchema } from '$lib/auth/registration';
import { collectionPreferencesSchema } from '$lib/collection/preferences';
import { socialSettingsSchema } from '$lib/social/model';
import * as v from 'valibot';
import { asc, and, eq, sql } from 'drizzle-orm';
import { getDb, getSql } from '../db';
import { users, providerConnections, providerInstances, type UserSettings } from '../db/schema';
import { getConfig } from '../config';
import { AppError } from '../security/errors';

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  settings: UserSettings;
}
export interface SessionResult {
  user: SessionUser;
  token: string;
  expiresAt: Date;
}
export interface AuthenticatedSession {
  user: SessionUser;
  token?: string;
  expiresAt: Date;
}

export const accountSchema = v.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60))),
  email: v.optional(v.union([v.pipe(v.string(), v.email(), v.maxLength(254)), v.literal('')])),
});
const createAccountSchema = v.object({
  ...accountSchema.entries,
  role: v.optional(v.picklist(['admin', 'user']), 'user'),
});
const loginSchema = v.object({
  username: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(32)),
  password: v.pipe(v.string(), v.maxLength(128)),
});
const attemptWindows = new Map<string, { count: number; start: number }>();
let dummyPasswordHash: Promise<string> | undefined;

export function checkLoginRate(key: string) {
  const now = Date.now();
  const previous = attemptWindows.get(key);
  if (!previous || now - previous.start > 15 * 60_000) {
    if (attemptWindows.size >= 10_000)
      for (const [entry, window] of attemptWindows)
        if (now - window.start > 15 * 60_000) attemptWindows.delete(entry);
    if (attemptWindows.size >= 10_000) throw new AppError(429, 'Please wait before trying again.');
    attemptWindows.set(key, { count: 1, start: now });
    return;
  }
  previous.count++;
  if (previous.count > 10)
    throw new AppError(429, 'Too many sign-in attempts. Please wait 15 minutes.');
}

export async function hashToken(token: string): Promise<string> {
  return Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  ).toString('hex');
}
export function randomToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}
function publicUser(
  row: Pick<typeof users.$inferSelect, 'id' | 'username' | 'email' | 'role' | 'settings'>
): SessionUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    role: row.role,
    settings: row.settings || {},
  };
}
export function requireUser(actor: SessionUser | null | undefined): SessionUser {
  if (!actor)
    throw new AppError(401, 'Your session has expired. Sign in to continue.', 'session_expired');
  return actor;
}
export function requireAdmin(actor: SessionUser | null | undefined): SessionUser {
  const user = requireUser(actor);
  if (user.role !== 'admin') throw new AppError(403, 'Administrator access is required.');
  return user;
}

export async function setupRequired(): Promise<boolean> {
  const [row] = await getSql()`SELECT EXISTS (SELECT 1 FROM users) AS exists`;
  return !row.exists;
}

export async function newSession(user: SessionUser): Promise<SessionResult> {
  const { sessionLifetimeDays } = await getConfig();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + sessionLifetimeDays * 86_400_000);
  await getSql()`INSERT INTO sessions (user_id, token_hash, expires_at, last_seen_at) VALUES (${user.id}, ${await hashToken(token)}, ${expiresAt}, NOW())`;
  return { user, token, expiresAt };
}

export async function createFirstAdmin(input: unknown): Promise<SessionResult> {
  const account = v.parse(accountSchema, input);
  const passwordHash = await Bun.password.hash(account.password, {
    algorithm: 'argon2id',
    memoryCost: 19456,
    timeCost: 2,
  });
  const user = await getSql().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(73001601)`;
    const [count] = await sql`SELECT EXISTS (SELECT 1 FROM users) AS exists`;
    if (count.exists) throw new AppError(409, 'Coast has already been set up.');
    const [row] =
      await sql`INSERT INTO users (username, password_hash, email, role, settings) VALUES (${account.username}, ${passwordHash}, ${account.email || null}, 'admin', ${{profile:{displayName:account.displayName??account.username}}}::jsonb) RETURNING *`;
    return publicUser(row);
  });
  return newSession(user);
}

export async function login(input: unknown, clientKey = 'local'): Promise<SessionResult> {
  checkLoginRate(`ip:${clientKey}`);
  const account = v.parse(loginSchema, input);
  checkLoginRate(`account:${account.username}`);
  const [row] =
    await getSql()`SELECT * FROM users WHERE username = ${account.username} AND disabled = FALSE`;
  // Warm the same cached dummy for either branch, then spend one verification cost.
  const dummy = await (dummyPasswordHash ??= Bun.password.hash('coast-nonexistent-account-dummy', {
    algorithm: 'argon2id',
    memoryCost: 19456,
    timeCost: 2,
  }));
  const hash = row?.password_hash || dummy;
  const valid = await Bun.password.verify(account.password, hash);
  if (!row || !row.password_hash || !valid)
    throw new AppError(401, 'The username or password is incorrect.');
  return newSession(publicUser(row));
}

export async function authenticateSession(
  token: string | undefined
): Promise<AuthenticatedSession | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = await hashToken(token);
  const { sessionLifetimeDays } = await getConfig();
  return getSql().begin(async (sql) => {
    const [session] = await sql`SELECT * FROM sessions WHERE token_hash = ${tokenHash}
      OR (previous_token_hash = ${tokenHash} AND previous_valid_until > NOW()) FOR UPDATE`;
    if (!session || new Date(session.expires_at).getTime() <= Date.now()) return null;
    const [row] = await sql`SELECT * FROM users WHERE id = ${session.user_id} AND disabled = FALSE`;
    if (!row) return null;
    const user = publicUser(row);
    if (
      session.token_hash === tokenHash &&
      Date.now() - new Date(session.last_seen_at).getTime() > 60 * 60_000
    ) {
      const nextToken = randomToken();
      const expiresAt = new Date(Date.now() + sessionLifetimeDays * 86_400_000);
      await sql`UPDATE sessions SET previous_token_hash = token_hash, previous_valid_until = NOW() + INTERVAL '30 seconds',
        token_hash = ${await hashToken(nextToken)}, expires_at = ${expiresAt}, last_seen_at = NOW() WHERE id = ${session.id}`;
      return { user, token: nextToken, expiresAt };
    }
    return { user, expiresAt: new Date(session.expires_at) };
  });
}

export async function logout(token: string | undefined) {
  if (!token) return;
  const hashed = await hashToken(token);
  await getSql()`DELETE FROM sessions WHERE token_hash = ${hashed} OR previous_token_hash = ${hashed}`;
}

export async function createUser(actor: SessionUser | null, input: unknown): Promise<SessionUser> {
  requireAdmin(actor);
  const account = v.parse(createAccountSchema, input);
  const passwordHash = await Bun.password.hash(account.password, {
    algorithm: 'argon2id',
    memoryCost: 19456,
    timeCost: 2,
  });
  try {
    const [row] =
      await getSql()`INSERT INTO users (username, password_hash, email, role) VALUES (${account.username}, ${passwordHash}, ${account.email || null}, ${account.role}) RETURNING *`;
    return publicUser(row);
  } catch (error) {
    if ((error as { errno?: string }).errno === '23505')
      throw new AppError(409, 'That username is already in use.');
    throw error;
  }
}

export async function updatePassword(
  actor: SessionUser | null,
  currentPassword: string,
  nextPassword: unknown
): Promise<void> {
  const user = requireUser(actor);
  checkLoginRate(`password-change:${user.id}`);
  const next = v.parse(passwordSchema, nextPassword);
  const [row] = await getSql()`SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (!row?.password_hash || !(await Bun.password.verify(currentPassword, row.password_hash)))
    throw new AppError(403, 'The current password is incorrect.');
  const hash = await Bun.password.hash(next, {
    algorithm: 'argon2id',
    memoryCost: 19456,
    timeCost: 2,
  });
  await getSql().begin(async (sql) => {
    await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`;
    await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
  });
}

export async function listUsers(actor: SessionUser | null) {
  requireAdmin(actor);
  return getDb()
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      role: users.role,
      settings: users.settings,
      disabled: users.disabled,
      hasLocalPassword: sql<boolean>`${users.passwordHash} is not null`,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));
}

export async function deleteUser(actor: SessionUser | null, userId: string): Promise<void> {
  const admin = requireAdmin(actor);
  if (admin.id === userId)
    throw new AppError(400, 'You cannot delete your current administrator account.');
  await getSql().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(73001602)`;
    const [target] = await sql`SELECT id, role FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!target) throw new AppError(404, 'Account not found.');
    if (target.role === 'admin') {
      const [count] =
        await sql`SELECT count(*)::int AS total FROM users WHERE role = 'admin' AND disabled = FALSE`;
      if (count.total <= 1) throw new AppError(409, 'Keep at least one administrator account.');
    }
    // Provider account deletion is deliberately a separate, explicit adapter operation.
    await sql`DELETE FROM users WHERE id = ${userId}`;
  });
}

export async function updateUser(actor: SessionUser | null, userId: string, input: unknown) {
  const admin = requireAdmin(actor);
  const patch = v.parse(
    v.partial(
      v.object({
        email: accountSchema.entries.email,
        role: v.picklist(['admin', 'user']),
        disabled: v.boolean(),
        password: passwordSchema,
      })
    ),
    input
  );
  if (
    admin.id === userId &&
    (patch.disabled || patch.role === 'user' || patch.password !== undefined)
  )
    throw new AppError(
      400,
      'Use your account settings to change your password. Another administrator must change your role or disable your account.'
    );
  const hash =
    patch.password === undefined
      ? null
      : await Bun.password.hash(patch.password, {
          algorithm: 'argon2id',
          memoryCost: 19456,
          timeCost: 2,
        });
  return getSql().begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(73001602)`;
    const [target] = await transaction`SELECT * FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!target) throw new AppError(404, 'Account not found.');
    const role = patch.role ?? target.role;
    const disabled = patch.disabled ?? target.disabled;
    if (target.role === 'admin' && !target.disabled && (role !== 'admin' || disabled)) {
      const [count] =
        await transaction`SELECT count(*)::int AS total FROM users WHERE role = 'admin' AND disabled = FALSE AND id <> ${userId}`;
      if (!count.total) throw new AppError(409, 'Keep at least one active administrator account.');
    }
    const [row] =
      await transaction`UPDATE users SET email = ${patch.email === undefined ? target.email : patch.email || null}, role = ${role}, disabled = ${disabled}, password_hash = ${hash ?? target.password_hash} WHERE id = ${userId} RETURNING *`;
    if (role !== target.role || disabled !== target.disabled || hash)
      await transaction`DELETE FROM sessions WHERE user_id = ${userId}`;
    return { ...publicUser(row), disabled: row.disabled, hasLocalPassword: !!row.password_hash };
  });
}

export async function updateUserSettings(actor: SessionUser | null, input: unknown) {
  const user = requireUser(actor);
  const settings = v.parse(
    v.partial(
      v.object({
        syncConflictWinner: v.union([
          v.literal('manual'),
          v.literal('coast'),
          v.pipe(v.string(), v.uuid()),
        ]),
        social: socialSettingsSchema,
        collection: collectionPreferencesSchema,
        shareDemand: v.boolean(),
        listenThreshold: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)),
        fullWidth: v.boolean(),
        originalTitles: v.boolean(),
        region: v.pipe(v.string(), v.regex(/^[A-Z]{2}$/)),
        theme: v.optional(v.picklist(['dark', 'light', 'system'])),
        notificationLevel: v.optional(v.picklist(['silent', 'normal', 'persistent'])),
        notificationsSilenced: v.boolean(),
        subtitleLanguages: v.array(v.string()),
        subtitlesAlways: v.boolean(),
        subtitlePrompt: v.boolean(),
      })
    ),
    input
  );
  if (
    settings.syncConflictWinner !== undefined &&
    !['manual', 'coast'].includes(settings.syncConflictWinner) &&
    settings.syncConflictWinner !== user.settings.syncConflictWinner
  ) {
    const [connection] = await getDb()
      .select({ id: providerConnections.id })
      .from(providerConnections)
      .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
      .where(
        and(
          eq(providerConnections.id, settings.syncConflictWinner),
          eq(providerConnections.userId, user.id),
          eq(providerConnections.status, 'connected'),
          eq(providerInstances.enabled, true)
        )
      );
    if (!connection) throw new AppError(400, 'Choose one of your connected accounts.');
  }
  await getSql()`UPDATE users SET settings = settings || ${settings}::jsonb WHERE id = ${user.id}`;
  return settings;
}

export async function resetUserSettings(actor: SessionUser | null) {
  const user = requireUser(actor);
  await getSql()`UPDATE users SET settings = CASE WHEN settings ? 'profile' THEN jsonb_build_object('profile', settings->'profile') ELSE '{}'::jsonb END WHERE id = ${user.id}`;
}
