import { serviceTasks } from './tasks';
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
import { correlationId } from '$lib/diagnostics';
import { context, logDiagnostic } from '$lib/server/diagnostics';
import { requireProviderAdmin, getInstance } from '$lib/providers/instances.server';

export async function updateProviderSchedule(adminId: string, instanceId: string, input: unknown) {
  await requireProviderAdmin(adminId);
  const instance = await getInstance(instanceId);
  if (!['jellyfin', 'seerr', 'trakt', 'tmdb'].includes(instance.provider))
    throw new Error('This integration has no scheduled jobs.');
  const patch = v.parse(v.partial(providerScheduleSchema), input);
  if (!Object.keys(patch).length) throw new Error('Choose a schedule setting to update.');
  return getDb().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(providerInstances)
      .where(eq(providerInstances.id, instanceId))
      .for('update');
    if (!current) throw new Error('Integration not found.');
    const schedule = v.parse(providerScheduleSchema, {
      ...providerSchedule(current.provider, current.settings.schedule),
      ...patch,
    });
    if (patch.libraryConnectionId) {
      const [source] = await tx
        .select({ id: providerConnections.id })
        .from(providerConnections)
        .innerJoin(users, eq(users.id, providerConnections.userId))
        .where(
          and(
            eq(providerConnections.id, patch.libraryConnectionId),
            eq(providerConnections.instanceId, instanceId),
            eq(providerConnections.status, 'connected'),
            eq(users.disabled, false)
          )
        );
      if (current.provider !== 'jellyfin' || !source)
        throw new Error('Choose a connected account for this Jellyfin service.');
    }
    await tx
      .update(providerInstances)
      .set({
        settings: sql`jsonb_set(${providerInstances.settings},'{schedule}',${schedule}::jsonb,true)`,
      })
      .where(eq(providerInstances.id, instanceId));
    return schedule;
  });
}

export async function runProviderJob(
  adminId: string,
  instanceId: string,
  task: 'all' | 'library' | 'users' | 'tracking' | 'lists' | 'live' | 'catalogue' | 'metadata' = 'all',
  kind?: string
) {
  await requireProviderAdmin(adminId);
  const instance = await getInstance(instanceId);
  if (!['jellyfin', 'seerr', 'trakt', 'tmdb'].includes(instance.provider))
    throw new Error('This integration has no scheduled jobs.');
  if (
    task !== 'all' &&
    !(
      instance.provider === 'jellyfin'
        ? ['library', 'users', 'catalogue']
        : instance.provider === 'trakt'
          ? ['tracking', 'lists', 'live', 'catalogue']
          : instance.provider === 'tmdb' ? ['metadata'] : []
    ).includes(task)
  )
    throw new Error('This task is unavailable for the selected service.');
  if (kind && !serviceTasks(instance.provider).some(entry => entry.scope === task && entry.kinds.includes(kind))) throw new Error('This job is unavailable for the selected service.');
  return scheduleProviderMaintenance({ instanceId, force: true, task, adminId, kind });
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
  options: {
    instanceId?: string;
    kind?: string;
    adminId?: string;
    force?: boolean;
    task?: 'all' | 'library' | 'users' | 'tracking' | 'lists' | 'live' | 'catalogue' | 'metadata';
  } = {}
) {
  const config = await getConfig();
  return getDb().transaction(async (tx) => {
    // Prevent overlapping timer/manual runs across processes without waiting or duplicating work.
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended('provider-maintenance',0)) as acquired`
    );
    if (!lock.acquired) return { queued: 0, active: 0, connections: 0, busy: true };
    if(!options.instanceId)await tx.execute(sql`
      insert into outbox_actions(user_id,kind,payload,compaction_key)
      select c.user_id,'social.checkin-complete',jsonb_build_object('checkinId',c.id),'checkin-complete:'||c.id
      from social_checkins c join users u on u.id=c.user_id
      where c.state='active' and c.expires_at<=now() and not u.disabled
      and not exists(select 1 from outbox_actions a where a.user_id=c.user_id and a.compaction_key='checkin-complete:'||c.id and a.state in ('pending','running','failed'))
    `);
    // Queued jobs from the combined scanner cannot safely run under the split task model.
    await tx
      .update(outboxActions)
      .set({
        state: 'cancelled',
        lastError: 'Replaced by separate library and user tasks.',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboxActions.kind, 'jellyfin.scan'),
          inArray(outboxActions.state, ['pending', 'failed'])
        )
      );
    const [tmdb] = await tx.select({ id: providerInstances.id }).from(providerInstances).where(and(eq(providerInstances.provider, 'tmdb'), eq(providerInstances.enabled, true), sql`${providerInstances.credentials} is not null`)).limit(1);
    const metadata = await (await import('$lib/catalogue/maintenance.server')).scheduleMetadataRefresh(tx, options);
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
      )
      .orderBy(providerConnections.createdAt, providerConnections.id);
    const eligible = rows.filter(
      ({ instance }) =>
        (instance.provider !== 'trakt' || config.enableTrakt) &&
        (instance.provider !== 'seerr' || config.enableRequests) &&
        (options.force || providerSchedule(instance.provider, instance.settings.schedule).enabled)
    );
    if (!eligible.length) return { ...metadata, connections: 0, busy: false };
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
            inArray(outboxActions.kind, [
              'catalogue.user-scan',
              'jellyfin.library',
              'jellyfin.sync',
              'trakt.live',
              'trakt.import',
              'trakt.lists-import',
              'trakt.collection-project',
              'seerr.sync',
            ])
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
    let queued = metadata.queued,
      active = metadata.active;
    const now = Date.now();
    const handledLibraries = new Set<string>();
    const requests = new Map<string, { connection: (typeof eligible)[number]['connection']; kind: string; payload: Record<string, unknown>; last: number }[]>();
    async function queue(connection: (typeof eligible)[number]['connection'], kind: string, payload: Record<string, unknown> = {}) {
      if (options.kind && options.kind !== kind) return;
      const key=`${connection.instanceId}:${kind}`;
      const last=kind==='jellyfin.sync' ? checkpointByKey.get(`${connection.id}:jellyfin-user`)??0 : new Date(jobsByKey.get(`${connection.id}:${kind}`)?.last??0).getTime();
      const candidates=requests.get(key)??[];
      candidates.push({connection,kind,payload,last});requests.set(key,candidates);
    }
    for (const { instance, connection } of eligible) {
      const schedule = providerSchedule(instance.provider, instance.settings.schedule);
      if (tmdb && ['jellyfin', 'trakt'].includes(instance.provider) && (!options.task || ['all', 'catalogue'].includes(options.task)) && (options.force || schedule.catalogueEnabled)) {
        const job = jobsByKey.get(`${connection.id}:catalogue.user-scan`);
        if (job?.active) active++;
        else if (options.force || !job?.last || now - new Date(job.last).getTime() >= schedule.catalogueIntervalMinutes * 60000) await queue(connection, 'catalogue.user-scan');
      }
      if (options.task === 'catalogue' || options.task === 'metadata') continue;
      if (instance.provider === 'jellyfin') {
        if (!handledLibraries.has(instance.id)) {
          handledLibraries.add(instance.id);
          const accounts = eligible
            .filter((row) => row.instance.id === instance.id)
            .map((row) => row.connection);
          const progress = instance.settings.libraryScan as Record<string, unknown> | undefined;
          const sourceId = schedule.libraryConnectionId ?? progress?.connectionId;
          const source =
            accounts.find((account) => account.id === sourceId) ??
            (schedule.libraryConnectionId ? undefined : accounts[0]);
          const fullAt = Date.parse(String(progress?.fullCompletedAt ?? '')) || 0;
          const recentAt = Date.parse(String(progress?.recentCompletedAt ?? '')) || 0;
          const full =
            !!options.force ||
            source?.id !== progress?.connectionId ||
            source?.externalUserId !== progress?.externalUserId ||
            now - fullAt >= schedule.fullIntervalHours * 3600000;
          const libraryActive = accounts.some(
            (account) => jobsByKey.get(`${account.id}:jellyfin.library`)?.active
          );
          if (options.task !== 'users' && (options.force || schedule.libraryEnabled)) {
            if (libraryActive) active++;
            else if (
              source &&
              (full || now - Math.max(fullAt, recentAt) >= schedule.intervalMinutes * 60000)
            )
              await queue(source, 'jellyfin.library', { full });
          }
        }
        const last = checkpointByKey.get(`${connection.id}:jellyfin-user`) ?? 0;
        if (options.task !== 'library' && (options.force || schedule.userSyncEnabled)) {
          if (jobsByKey.get(`${connection.id}:jellyfin.sync`)?.active) active++;
          else if (options.force || now - last >= schedule.userIntervalMinutes * 60000)
            await queue(connection, 'jellyfin.sync');
        }
        continue;
      }
      if (instance.provider === 'trakt') {
        if((!options.task||['all','live'].includes(options.task))&&(options.force||schedule.liveEnabled)&&connection.settings.liveRead!==false){
          const live=jobsByKey.get(`${connection.id}:trakt.live`);
          const [presence]=await tx.execute<{active:boolean}>(sql`select exists(select 1 from social_live_state where connection_id=${connection.id} and account_generation=${connection.accountGeneration} and expires_at>now()) or exists(select 1 from playback_sessions where user_id=${connection.userId} and state='active' and updated_at>now()-interval '2 minutes') or exists(select 1 from social_checkins where user_id=${connection.userId} and state='active') as active`);
          const interval=presence?.active?schedule.liveActiveMinutes:schedule.liveIdleMinutes;
          if(!live?.active&&(options.force||!live?.last||now-new Date(live.last).getTime()>=interval*60000))await queue(connection,'trakt.live');
        }
        if(options.task==='live')continue;
        if(options.task !== 'lists' && (options.force || schedule.trackingEnabled) && (connection.settings.collectionProjection as {enabled?:boolean})?.enabled){
          const projectionJob=jobsByKey.get(`${connection.id}:trakt.collection-project`);
          if(!projectionJob?.active && (options.force||!projectionJob?.last||now-new Date(projectionJob.last).getTime()>=schedule.intervalMinutes*60000))await queue(connection,'trakt.collection-project');
        }
        const sync = connection.settings.sync as Record<string, boolean> | undefined;
        if (
          options.task !== 'tracking' &&
          (options.force || schedule.listsEnabled) &&
          sync?.lists
        ) {
          const listsJob = jobsByKey.get(`${connection.id}:trakt.lists-import`);
          const last = listsJob?.last ? new Date(listsJob.last).getTime() : 0;
          if (listsJob?.active) active++;
          else if (options.force || now - last >= schedule.listsIntervalMinutes * 60000)
            await queue(connection, 'trakt.lists-import');
        }
        if (
          options.task === 'lists' ||
          (!options.force && !schedule.trackingEnabled) ||
          !['history', 'progress', 'collection', 'ratings', 'watchlist'].some(
            (category) => sync?.[category]
          )
        )
          continue;
      }
      const kind = instance.provider === 'trakt' ? 'trakt.import' : 'seerr.sync';
      const job = jobsByKey.get(`${connection.id}:${kind}`);
      if (job?.active) {
        active++;
        continue;
      }
      const checked = Date.parse(String(connection.settings.requestsVerifiedAt ?? '')) || 0;
      const last =
        instance.provider === 'seerr' ? checked : job?.last ? new Date(job.last).getTime() : 0;
      if (options.force || now - last >= schedule.intervalMinutes * 60000)
        await queue(connection, kind);
    }
    for(const candidates of requests.values()) {
      const chosen=candidates.sort((a,b)=>a.last-b.last||a.connection.createdAt.getTime()-b.connection.createdAt.getTime())[0];
      const {connection,kind,payload}=chosen;
      const [existing]=await tx.select({id:outboxActions.id}).from(outboxActions).innerJoin(providerConnections,eq(providerConnections.id,outboxActions.connectionId)).where(and(eq(providerConnections.instanceId,connection.instanceId),eq(outboxActions.kind,kind),inArray(outboxActions.state,['pending','running']))).limit(1);
      if(existing)continue;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${connection.userId}:${connection.id}`},0))`);
      await tx.insert(outboxActions).values({userId:connection.userId,connectionId:connection.id,kind,payload,compactionKey:kind,correlationId:correlationId(context.getStore()),createdAt:sql`clock_timestamp()`});queued++;
    }
    return { queued, active, connections: eligible.length, busy: false };
  });
}

export function startProviderMaintenance() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    void scheduleProviderMaintenance().catch(() =>
      logDiagnostic('error', 'job.failed', { stage: 'maintenance', failure: 'unexpected' })
    );
  }, 60000);
  maintenanceTimer.unref();
  process.once('SIGTERM', stopProviderMaintenance);
  process.once('SIGINT', stopProviderMaintenance);
  void scheduleProviderMaintenance().catch(() =>
    logDiagnostic('error', 'job.failed', { stage: 'maintenance', failure: 'unexpected' })
  );
}
