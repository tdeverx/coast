import { diagnosticStore } from '../diagnostics';
import * as v from 'valibot';
import { and, desc, eq, isNull,sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getDb, getSql, type Database } from '../db';
import { notifications, type UserSettings } from '../db/schema';
import { getConfig, type CoastConfig } from '../config';
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
  data?: import('../../social/model').NotificationData;
}
export type NotificationDatabase = ReturnType<typeof getSql> | Pick<Database, 'execute'>;
const notificationBatchSize = 100;
const notificationDialect = new PgDialect();
async function notificationQuery<T extends Record<string, unknown>>(database: NotificationDatabase, query: SQL): Promise<T[]> {
  if ('execute' in database) return Array.from(await database.execute<T>(query)) as T[];
  const compiled = notificationDialect.sqlToQuery(query);
  return Array.from(await database.unsafe(compiled.sql, compiled.params)) as T[];
}

function notificationValues(input: NotificationInput, settings: UserSettings, config: CoastConfig) {
  const socialNotifications: Partial<Record<string, boolean>> | undefined = settings.social?.notifications;
  if (input.data && socialNotifications?.[input.kind] === false) return null;
  const maySilence = config.allowNotificationSilencing && !input.locked;
  const userLevel = settings.notificationsSilenced ? 'silent' : settings.notificationLevel;
  const requestedLevel = maySilence && userLevel && ['silent', 'normal', 'persistent'].includes(userLevel)
    ? userLevel : input.level || config.notificationLevel;
  const level = input.locked && requestedLevel === 'silent' ? 'normal' : requestedLevel;
  return sql`(${input.userId}::uuid, ${input.kind}, ${input.title.slice(0, 160)}, ${input.body?.slice(0, 2000) || null},
    ${level}, ${input.locked || false}, ${input.sourceKey || null}, ${input.data ?? null}::jsonb)`;
}

/** Share preference decisions and bounded writes across single notices and broadcasts. */
async function writeNotifications(inputs: NotificationInput[], settings: Map<string, UserSettings>, config: CoastConfig, database: NotificationDatabase) {
  const ids: string[] = [], values: SQL[] = [], keys = new Set<string>();
  const flush = async () => {
    if (!values.length) return;
    const rows = await notificationQuery<{id: string}>(database, sql`INSERT INTO notifications (user_id, kind, title, body, level, locked, source_key, data)
      SELECT proposed.* FROM (VALUES ${sql.join(values, sql`, `)}) AS proposed(user_id,kind,title,body,level,locked,source_key,data)
      WHERE coast_notification_visible(proposed.user_id::uuid,proposed.kind,proposed.data,proposed.source_key)
      ON CONFLICT (user_id, source_key) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, level = EXCLUDED.level, locked = EXCLUDED.locked, data = EXCLUDED.data
      RETURNING id`);
    ids.push(...rows.map(row => row.id)); values.length = 0; keys.clear();
  };
  for (const input of inputs) {
    const user = settings.get(input.userId);
    if (!user) continue;
    const value = notificationValues(input, user, config);
    if (!value) continue;
    const key = input.sourceKey ? JSON.stringify([input.userId, input.sourceKey]) : null;
    // Repeated keys preserve sequential upserts instead of failing a multi-row INSERT.
    if (key && keys.has(key)) await flush();
    values.push(value); if (key) keys.add(key);
    if (values.length === notificationBatchSize) await flush();
  }
  await flush();
  return ids;
}

export async function notifyMany(inputs: NotificationInput[], database: NotificationDatabase = getSql()) {
  if (!inputs.length) return [];
  const config = await getConfig(database), ids: string[] = [];
  for (let offset = 0; offset < inputs.length; offset += notificationBatchSize) {
    const batch = inputs.slice(offset, offset + notificationBatchSize);
    const users = await notificationQuery<{id: string; settings: UserSettings | null}>(database,
      sql`SELECT id, settings FROM users WHERE id IN (${sql.join([...new Set(batch.map(input => input.userId))].map(id => sql`${id}::uuid`), sql`, `)})`);
    ids.push(...await writeNotifications(batch, new Map(users.map(user => [user.id, user.settings || {}])), config, database));
  }
  return ids;
}

export async function notify(input: NotificationInput, database: NotificationDatabase = getSql()) {
  return (await notifyMany([input], database))[0];
}

export async function resolveNotification(userId: string, sourceKey: string, database = getSql()) {
  await database`DELETE FROM notifications WHERE user_id = ${userId} AND source_key = ${sourceKey}`;
}
export async function inbox(actor: SessionUser | null, limit = 50,filters:{kind?:string;unread?:boolean}={}) {
  const user = requireUser(actor);
  const rows = await getDb()
    .select({
      id: notifications.id,
      kind: notifications.kind,
      data: notifications.data,
      title: notifications.title,
      body: notifications.body,
      level: notifications.level,
      locked: notifications.locked,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id),sql`${notifications.kind}<>'friend-request'`, isNull(notifications.dismissedAt),sql`coast_notification_visible(${user.id}::uuid,${notifications.kind},${notifications.data},${notifications.sourceKey})`,sql`not exists(select 1 from outbox_actions job where ${notifications.kind}='external-action' and job.id::text=split_part(${notifications.sourceKey},':',2) and job.user_id=${notifications.userId} and job.state in ('cancelled','succeeded'))`,filters.kind&&filters.kind!=='all'?eq(notifications.kind,filters.kind):undefined,filters.unread?isNull(notifications.readAt):undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.max(1, Math.min(200, limit)));
  return rows;
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
  const database = getSql(), config = await getConfig(database);
  let cursor: string | null = null, delivered = 0;
  while (true) {
    const users: {id: string; settings: UserSettings | null}[] = await notificationQuery(database,
      sql`SELECT id, settings FROM users WHERE disabled = FALSE ${cursor ? sql`AND id > ${cursor}::uuid` : sql``}
        ORDER BY id LIMIT ${notificationBatchSize}`);
    if (!users.length) break;
    const inputs = users.map(user => ({...message, userId: user.id, kind: 'administrator', sourceKey: `broadcast:${crypto.randomUUID()}`}));
    delivered += (await writeNotifications(inputs, new Map(users.map(user => [user.id, user.settings || {}])), config, database)).length;
    cursor = users[users.length - 1].id;
    if (users.length < notificationBatchSize) break;
  }
  return { delivered };
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
