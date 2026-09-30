import { providerSchedule, providerScheduleSchema } from '$lib/providers/schedule';
import * as v from 'valibot';
import { and, eq, sql, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  users,
  providerInstances,
  providerConnections,
  outboxActions,
  syncCheckpoints,
} from '$lib/server/db/schema';
import { getConfig } from '$lib/server/config';
import { enqueueAction } from '$lib/server/queue';
import { requireProviderAdmin, getInstance } from '$lib/providers/instances.server';

export async function updateProviderSchedule(
  adminId: string,
  instanceId: string,
  input: unknown
) {
  await requireProviderAdmin(adminId);
  const instance = await getInstance(instanceId);
  if (!['jellyfin', 'seerr', 'trakt'].includes(instance.provider))
    throw new Error('This integration has no scheduled jobs.');
  const schedule = v.parse(providerScheduleSchema, input);
  await getDb()
    .update(providerInstances)
    .set({
      settings: sql`jsonb_set(${providerInstances.settings},'{schedule}',${schedule}::jsonb,true)`,
    })
    .where(eq(providerInstances.id, instanceId));
  return schedule;
}

export async function runProviderJob(adminId: string, instanceId: string) {
  await requireProviderAdmin(adminId);
  const instance = await getInstance(instanceId);
  if (!['jellyfin', 'seerr', 'trakt'].includes(instance.provider))
    throw new Error('This integration has no scheduled jobs.');
  return scheduleProviderMaintenance({ instanceId, force: true });
}

let maintenanceTimer: ReturnType<typeof setInterval> | undefined;

export function stopProviderMaintenance() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = undefined;
  }
}

/** Idempotent maintenance scheduling; durable work remains in the PostgreSQL outbox. */
/** One integration schedule covers every connected account. Queue lanes keep credentials and retries isolated. */
export async function scheduleProviderMaintenance(
  options: { instanceId?: string; force?: boolean } = {}
) {
  return getDb().transaction(async (tx) => {
    // Prevent overlapping timer/manual runs across processes without waiting or duplicating work.
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended('provider-maintenance',0)) as acquired`
    );
    if (!lock.acquired) return { queued: 0, active: 0, connections: 0, busy: true };
    const config = await getConfig();
    const rows = await tx
      .select({ connection: providerConnections, instance: providerInstances })
      .from(providerConnections)
      .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
      .innerJoin(users, eq(users.id, providerConnections.userId))
      .where(
        and(
          eq(providerConnections.status, 'connected'),
          eq(providerInstances.enabled, true),
          eq(users.disabled, false),
          options.instanceId ? eq(providerInstances.id, options.instanceId) : undefined,
          inArray(providerInstances.provider, ['jellyfin', 'trakt', 'seerr'])
        )
      );
    const eligible = rows.filter(
      ({ instance }) =>
        (instance.provider !== 'trakt' || config.enableTrakt) &&
        (instance.provider !== 'seerr' || config.enableRequests) &&
        (options.force ||
          providerSchedule(instance.provider, instance.settings.schedule).enabled)
    );
    if (!eligible.length) return { queued: 0, active: 0, connections: 0, busy: false };
    const ids = eligible.map((row) => row.connection.id);
    const [jobs, checkpoints] = await Promise.all([
      tx
        .select({
          connectionId: outboxActions.connectionId,
          kind: outboxActions.kind,
          active: sql<boolean>`bool_or(${outboxActions.state} in ('pending','running','failed'))`,
          last: sql<Date | null>`max(${outboxActions.updatedAt}) filter(where ${outboxActions.state}='succeeded')`,
        })
        .from(outboxActions)
        .where(
          and(
            inArray(outboxActions.connectionId, ids),
            inArray(outboxActions.kind, ['jellyfin.scan', 'trakt.import', 'seerr.sync'])
          )
        )
        .groupBy(outboxActions.connectionId, outboxActions.kind),
      tx.select().from(syncCheckpoints).where(inArray(syncCheckpoints.connectionId, ids)),
    ]);
    const jobsByKey = new Map(jobs.map((job) => [`${job.connectionId}:${job.kind}`, job]));
    const checkpointByKey = new Map(
      checkpoints.map((point) => [
        `${point.connectionId}:${point.kind}`,
        point.completedAt?.getTime() ?? 0,
      ])
    );
    let queued = 0,
      active = 0;
    for (const { instance, connection } of eligible) {
      const schedule = providerSchedule(instance.provider, instance.settings.schedule);
      const kind =
        instance.provider === 'jellyfin'
          ? 'jellyfin.scan'
          : instance.provider === 'trakt'
            ? 'trakt.import'
            : 'seerr.sync';
      const job = jobsByKey.get(`${connection.id}:${kind}`);
      if (job?.active) {
        active++;
        continue;
      }
      const fullAt = checkpointByKey.get(`${connection.id}:jellyfin-full`) ?? 0;
      const recentAt = checkpointByKey.get(`${connection.id}:jellyfin-recent`) ?? 0;
      const full =
        !!options.force || Date.now() - fullAt > schedule.fullIntervalHours * 3600000;
      const checked = Date.parse(String(connection.settings.requestsVerifiedAt ?? '')) || 0;
      const last =
        instance.provider === 'jellyfin'
          ? Math.max(fullAt, recentAt)
          : instance.provider === 'seerr'
            ? checked
            : job?.last
              ? new Date(job.last).getTime()
              : 0;
      if (
        !options.force &&
        !(instance.provider === 'jellyfin' && full) &&
        Date.now() - last <= schedule.intervalMinutes * 60000
      )
        continue;
      await enqueueAction({
        userId: connection.userId,
        connectionId: connection.id,
        kind,
        payload: instance.provider === 'jellyfin' ? { full } : {},
        compactionKey: kind,
      });
      queued++;
    }
    return { queued, active, connections: eligible.length, busy: false };
  });
}

export function startProviderMaintenance() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    void scheduleProviderMaintenance().catch(() => {});
  }, 60000);
  maintenanceTimer.unref();
  process.once('SIGTERM', stopProviderMaintenance);
  process.once('SIGINT', stopProviderMaintenance);
  void scheduleProviderMaintenance().catch(() => {});
}
