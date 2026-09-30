import { diagnosticStore } from '../diagnostics';
import * as v from 'valibot';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb, getSql } from '../db';
import { notifications } from '../db/schema';
import { getConfig } from '../config';
import { requireAdmin, requireUser, type SessionUser } from '../auth';
import { AppError } from '../security/errors';

export interface NotificationInput {
  userId: string;
  kind: string;
  title: string;
  body?: string;
  level?: 'silent' | 'normal' | 'persistent';
  locked?: boolean;
  sourceKey?: string;
}
export async function notify(input: NotificationInput, database = getSql()) {
  const config = await getConfig(database);
  const [user] = await database`SELECT settings FROM users WHERE id = ${input.userId}`;
  if (!user) return;
  const maySilence = config.allowNotificationSilencing && !input.locked;
  const userLevel = user.settings?.notificationsSilenced
    ? 'silent'
    : user.settings?.notificationLevel;
  const requestedLevel =
    maySilence && ['silent', 'normal', 'persistent'].includes(userLevel)
      ? userLevel
      : input.level || config.notificationLevel;
  const level = input.locked && requestedLevel === 'silent' ? 'normal' : requestedLevel;
  const [row] =
    await database`INSERT INTO notifications (user_id, kind, title, body, level, locked, source_key)
    VALUES (${input.userId}, ${input.kind}, ${input.title.slice(0, 160)}, ${input.body?.slice(0, 2000) || null}, ${level}, ${input.locked || false}, ${input.sourceKey || null})
    ON CONFLICT (user_id, source_key) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, level = EXCLUDED.level, locked = EXCLUDED.locked
    RETURNING id`;
  return row.id as string;
}

export async function resolveNotification(userId: string, sourceKey: string, database = getSql()) {
  await database`DELETE FROM notifications WHERE user_id = ${userId} AND source_key = ${sourceKey}`;
}
export async function inbox(actor: SessionUser | null, limit = 50) {
  const user = requireUser(actor);
  return getDb()
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      level: notifications.level,
      locked: notifications.locked,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.dismissedAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.max(1, Math.min(200, limit)));
}
export async function markNotification(
  actor: SessionUser | null,
  id: string,
  action: 'read' | 'dismiss'
) {
  const user = requireUser(actor);
  const rows =
    action === 'dismiss'
      ? await getSql()`UPDATE notifications SET dismissed_at = NOW(), read_at = COALESCE(read_at, NOW()) WHERE id = ${id} AND user_id = ${user.id} RETURNING id`
      : await getSql()`UPDATE notifications SET read_at = NOW() WHERE id = ${id} AND user_id = ${user.id} RETURNING id`;
  if (!rows.length) throw new AppError(404, 'Notification not found.');
}

export async function broadcast(actor: SessionUser | null, input: unknown) {
  requireAdmin(actor);
  const message = v.parse(
    v.object({
      title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(160)),
      body: v.pipe(v.string(), v.maxLength(2000)),
      level: v.picklist(['silent', 'normal', 'persistent']),
      locked: v.boolean(),
    }),
    input
  );
  const users = await getSql()`SELECT id FROM users WHERE disabled = FALSE`;
  for (const user of users)
    await notify({
      ...message,
      userId: user.id,
      kind: 'administrator',
      sourceKey: `broadcast:${crypto.randomUUID()}`,
    });
  return { delivered: users.length };
}

export async function listDiagnostics(actor: SessionUser | null, limit = 100) {
  requireAdmin(actor);
  return (await diagnosticStore.recent()).slice(0, Math.max(1, Math.min(500, limit)));
}
export async function systemHealth(actor: SessionUser | null) {
  requireAdmin(actor);
  const started = Date.now();
  await getSql()`SELECT 1`;
  const actions =
    await getSql()`SELECT state, count(*)::int AS count FROM outbox_actions GROUP BY state`;
  const connections =
    await getSql()`SELECT status, count(*)::int AS count FROM provider_connections GROUP BY status`;
  return {
    database: { status: 'healthy', latencyMs: Date.now() - started },
    actions,
    connections,
    uptimeSeconds: Math.floor(process.uptime()),
    telemetry: false,
  };
}
