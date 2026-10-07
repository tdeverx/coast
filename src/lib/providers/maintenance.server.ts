import { pruneTransientRecords } from '$lib/server/storage/retention.server';
import { serviceTasks, maintenanceKinds } from './tasks';
import { jobIdentityScope } from './job-policy';
import { eligibleTaskAccounts, recurringTask, taskDue, taskSchedulingEnabled } from './task-timing';
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
  if (!['jellyfin', 'seerr', 'trakt', 'tmdb', 'steam','igdb'].includes(instance.provider))
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
    if(patch.streamsConnectionId){
      const [source]=await tx.select({id:providerConnections.id}).from(providerConnections).innerJoin(users,eq(users.id,providerConnections.userId)).where(and(eq(providerConnections.id,patch.streamsConnectionId),eq(providerConnections.instanceId,instanceId),eq(providerConnections.status,'connected'),eq(users.disabled,false),eq(users.role,'admin')));
      if(current.provider!=='jellyfin'||!source)throw new Error('Choose a connected administrator account for server streams.');
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
  task: 'all' | 'library' | 'users' | 'tracking' | 'lists' | 'live' | 'streams' | 'catalogue' | 'metadata' = 'all',
  kind?: string
) {
  await requireProviderAdmin(adminId);
  const instance = await getInstance(instanceId);
  if (!['jellyfin', 'seerr', 'trakt', 'tmdb', 'steam','igdb'].includes(instance.provider))
    throw new Error('This integration has no scheduled jobs.');
  if (
    task !== 'all' &&
    !serviceTasks(instance.provider).some(entry=>entry.scope===task)
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
  process.off('SIGTERM',stopProviderMaintenance);
  process.off('SIGINT',stopProviderMaintenance);
}

/** Idempotent maintenance scheduling; durable work remains in the PostgreSQL outbox. */
/** One integration schedule covers every connected account. Queue lanes keep credentials and retries isolated. */
export async function scheduleProviderMaintenance(
  options: {
    instanceId?: string;
    kind?: string;
    adminId?: string;
    force?: boolean;
    task?: 'all' | 'library' | 'users' | 'tracking' | 'lists' | 'live' | 'streams' | 'catalogue' | 'metadata';
  } = {}
) {
  const config = await getConfig();
  if(config.developerMode&&!options.force)return {queued:0,active:0,connections:0,busy:false};
  return getDb().transaction(async (tx) => {
    // Prevent overlapping timer/manual runs across processes without waiting or duplicating work.
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended('provider-maintenance',0)) as acquired`
    );
    if (!lock.acquired) return { queued: 0, active: 0, connections: 0, busy: true };
    if(options.force&&options.instanceId){
      const instance=await getInstance(options.instanceId);
      const kinds=serviceTasks(instance.provider).filter(task=>!options.task||options.task==='all'||task.scope===options.task).flatMap(task=>task.kinds).filter(kind=>!options.kind||kind===options.kind);
      if (kinds.length) await tx.execute(sql`update outbox_actions a set payload=a.payload||jsonb_build_object(
        '_manual',true,'_jobPurpose',case when a.payload->>'_jobPurpose' in ('playback','bootstrap','interactive') then a.payload->>'_jobPurpose' else 'manual' end)
        || case when a.kind='jellyfin.library' and a.payload->>'full'='false' then
          case when a.state='pending' then '{"full":true}'::jsonb else '{"_followupFull":true}'::jsonb end
          else '{}'::jsonb end
        where a.state in ('pending','running') and a.kind in (${sql.join(kinds.map(kind=>sql`${kind}`),sql`,`)})
        and (a.account_generation is null or a.account_generation=(select account_generation from provider_connections where id=a.connection_id))
        and coalesce((select instance_id::text from provider_connections where id=a.connection_id),a.payload->>'instanceId')=${options.instanceId}`);
    }
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
    const taste=options.instanceId?{queued:0,active:0}:await (await import('$lib/social/taste-cache.server')).scheduleTasteRefresh(tx);
    const metadata = await (await import('$lib/catalogue/maintenance.server')).scheduleMetadataRefresh(tx, options);
    const recommendations=await (await import('$lib/experiments/provider-recommendations.server')).scheduleRecommendationRefresh(tx,options);
    metadata.queued+=recommendations.queued+taste.queued;metadata.active+=recommendations.active+taste.active;
    const rows = await tx
      .select({ connection: providerConnections, instance: providerInstances, role:users.role })
      .from(providerConnections)
      .innerJoin(providerInstances, eq(providerInstances.id, providerConnections.instanceId))
      .innerJoin(users, eq(users.id, providerConnections.userId))
      .where(
        and(
          eq(providerConnections.status, 'connected'),
          eq(providerInstances.enabled, true),
          eq(users.disabled, false),
          options.instanceId ? eq(providerInstances.id, options.instanceId) : undefined,
          inArray(providerInstances.provider, ['jellyfin', 'trakt', 'seerr', 'steam'])
        )
      )
      .orderBy(providerConnections.createdAt, providerConnections.id);
    const eligible = rows.filter(
      ({ instance }) => taskSchedulingEnabled(instance.provider, instance.enabled,
        { id: 'instance', title: '', description: '', kinds: [] },
        providerSchedule(instance.provider, instance.settings.schedule), config, options.force)
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
            inArray(outboxActions.kind, maintenanceKinds),
            sql`(${outboxActions.accountGeneration} is null or ${outboxActions.accountGeneration}=(select account_generation from provider_connections where id=${outboxActions.connectionId}))`
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
    const presence = await tx.execute<{ id: string; live: boolean }>(sql`
      select c.id,exists(select 1 from social_live_state s where s.connection_id=c.id and s.account_generation=c.account_generation and s.expires_at>now())
        or exists(select 1 from playback_sessions p where p.user_id=c.user_id and p.state='active' and p.updated_at>now()-interval '2 minutes')
        or exists(select 1 from social_checkins s where s.user_id=c.user_id and s.state='active' and s.expires_at>now()) as live
      from provider_connections c where c.id in (${sql.join(ids.map(id=>sql`${id}`),sql`,`)})
    `);
    const requests = new Map<string, { connection: (typeof eligible)[number]['connection']; kind: string; payload: Record<string, unknown>; last: number }[]>();
    for (const instance of new Map(eligible.map(row => [row.instance.id, row.instance])).values()) {
      const schedule = providerSchedule(instance.provider, instance.settings.schedule);
      const linked = eligible.filter(row => row.instance.id === instance.id).map(row => ({
        ...row.connection, role: row.role, live: presence.find(account => account.id === row.connection.id)?.live ?? false,
        userCompleted: checkpointByKey.get(`${row.connection.id}:jellyfin-user`) ? new Date(checkpointByKey.get(`${row.connection.id}:jellyfin-user`)!) : null,
      }));
      const source=instance.settings.companion as import('./jellyfin/companion').CompanionState|undefined;
      const validSource=linked.some(c=>c.id===source?.connectionId&&c.accountGeneration===source?.generation&&c.role==='admin');
      const effectiveSettings=validSource?instance.settings:{...instance.settings,companion:undefined};
      for (const task of serviceTasks(instance.provider)) {
        const kind = task.kinds[0];
        if (!kind || !task.scope || (!recurringTask(kind) && options.kind !== kind) || (options.kind && options.kind !== kind)
          || (options.task && options.task !== 'all' && options.task !== task.scope)
          || !taskSchedulingEnabled(instance.provider, instance.enabled, task, schedule, config, options.force)) continue;
        // Metadata/recommendation schedulers above own their record/seed-specific evidence.
        if (kind.endsWith('.recommendations')) continue;
        const accounts = eligibleTaskAccounts(kind, linked, schedule, instance.settings, !!tmdb);
        const shared = jobIdentityScope(kind) === 'instance';
        const sharedJobs = jobs.filter(job => job.kind === kind && linked.some(account => account.id === job.connectionId));
        for (const account of accounts) {
          const job = jobsByKey.get(`${account.id}:${kind}`);
          const evidence = shared ? {
            blocked: sharedJobs.some(entry => entry.active),
            completed: new Date(Math.max(0, ...sharedJobs.map(entry => new Date(entry.last ?? 0).getTime()))),
          } : { blocked: job?.active, completed: job?.last };
          const due = taskDue(task, schedule, effectiveSettings, account, evidence, now, options.force);
          if (evidence.blocked) { active++; continue; }
          if (due.at == null || due.at > now) continue;
          const key = `${instance.id}:${kind}`;
          const candidates = requests.get(key) ?? [];
          candidates.push({ connection: account, kind, payload: due.full === undefined ? {} : { full: due.full }, last: due.completed });
          requests.set(key, candidates);
        }
      }
    }
    for (const candidates of requests.values()) {
      candidates.sort((a, b) => a.last - b.last || a.connection.createdAt.getTime() - b.connection.createdAt.getTime());
      // A timer rotates through due accounts; an explicit run requests every eligible account.
      const selected = options.force && jobIdentityScope(candidates[0].kind) === 'account' ? candidates : candidates.slice(0, 1);
      for (const { connection, kind, payload } of selected) {
        const scope = jobIdentityScope(kind);
        const [existing] = await tx.select({ id: outboxActions.id }).from(outboxActions)
          .innerJoin(providerConnections, eq(providerConnections.id, outboxActions.connectionId))
          .where(and(eq(outboxActions.kind, kind),
            scope === 'instance' ? eq(providerConnections.instanceId, connection.instanceId) : eq(outboxActions.connectionId, connection.id),
            sql`(${outboxActions.accountGeneration} is null or ${outboxActions.accountGeneration}=${providerConnections.accountGeneration})`,
            inArray(outboxActions.state, ['pending', 'running', 'failed']))).limit(1);
        if (existing) continue;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${connection.userId}:${connection.id}`},0))`);
        const purpose = options.force ? 'manual' : kind.endsWith('.live') || ['jellyfin.streams','jellyfin.updates'].includes(kind) ? 'live' : 'scheduled';
        await tx.insert(outboxActions).values({ userId: connection.userId, connectionId: connection.id, accountGeneration: connection.accountGeneration,
          kind, payload: { ...payload, _manual: !!options.force, _jobPurpose: purpose }, compactionKey: kind,
          correlationId: correlationId(context.getStore()), createdAt: sql`clock_timestamp()` });
        queued++;
      }
    }
    return { queued, active, connections: eligible.length, busy: false };
  });
}

let retentionDue = 0;
async function maintenanceTick() {
  if((await getConfig()).developerMode)return;
  await scheduleProviderMaintenance();
  if (Date.now() < retentionDue) return;
  const result = await pruneTransientRecords();
  if (!result.busy) {
    retentionDue = Date.now() + (result.more ? 60_000 : 3600_000);
    if (result.removed || result.expired) logDiagnostic('info', 'job.complete', { stage: 'retention', count: result.removed, expired: result.expired });
  }
}

export function startProviderMaintenance() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    void maintenanceTick().catch(() =>
      logDiagnostic('error', 'job.failed', { stage: 'maintenance', failure: 'unexpected' })
    );
  }, 60000);
  maintenanceTimer.unref();
  process.once('SIGTERM', stopProviderMaintenance);
  process.once('SIGINT', stopProviderMaintenance);
  void maintenanceTick().catch(() =>
    logDiagnostic('error', 'job.failed', { stage: 'maintenance', failure: 'unexpected' })
  );
}
