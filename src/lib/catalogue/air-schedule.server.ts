import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getTraktCommunity } from '#lib/providers/trakt/connection.server.js';
import type { TraktAdapter } from '#lib/providers/trakt/adapter.server.js';
import { getConfig, type CoastConfig } from '#lib/server/config.js';
import { getDb, type Database } from '#lib/server/db/index.js';
import { providerInstances } from '#lib/server/db/schema.js';
import { lockFeaturePolicyInTransaction } from '#lib/server/features.js';
import { assertJobLease } from '#lib/server/queue/execution.js';
import { PermanentActionError, type OutboxAction } from '#lib/server/queue/index.js';
import { providerSchedule } from '#lib/providers/schedule.js';
import { serviceTasks } from '#lib/providers/tasks.js';
import { taskSchedulingEnabled } from '#lib/providers/task-timing.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Calendar = Awaited<ReturnType<TraktAdapter['airSchedule']>>;

/** Fill schedule fields on known titles in one projection. A title alone is never an identity match. */
export async function saveTraktAirSchedule(tx: Transaction, instanceId: string, calendar: Calendar) {
  if(!calendar.length)return;
  await tx.execute(sql`
    with calendar as (
      select * from jsonb_to_recordset(${JSON.stringify(calendar)}::text::jsonb) as row(
        "traktId" text,"tmdbId" text,"episodeTmdbId" text,season integer,episode integer,"firstAiredAt" text,schedule jsonb)
    ), shows as (
      select calendar.*, matched.id as show_id from calendar
      cross join lateral (
        select min(i.media_id::text)::uuid as id from external_ids i where i.media_kind='show' and (
          (i.provider='tmdb' and i.external_id=calendar."tmdbId") or (i.provider='trakt' and i.external_id=calendar."traktId"))
        having count(distinct i.media_id)=1
      ) matched
    ), timing as (
      (select distinct on (show_id) show_id as id,jsonb_build_object('airSchedule',schedule) as raw from shows
        where schedule is not null order by show_id,"firstAiredAt" desc nulls last)
      union all
      (select distinct on (e.media_id) e.media_id,jsonb_build_object('firstAiredAt',shows."firstAiredAt")
        from shows join episodes e on e.show_id=shows.show_id and e.season_number=shows.season and e.episode_number=shows.episode
        where shows."firstAiredAt" is not null and (shows."episodeTmdbId" is null or not exists(
          select 1 from external_ids i where i.provider='tmdb' and i.media_kind='episode'
          and ((i.external_id=shows."episodeTmdbId" and i.media_id<>e.media_id)
            or (i.media_id=e.media_id and i.external_id<>shows."episodeTmdbId"))))
        order by e.media_id,shows."firstAiredAt" desc)
    ) insert into metadata_snapshots(media_id,provider,instance_id,raw)
    select id,'trakt',${instanceId},raw from timing
    on conflict (media_id,provider,(coalesce(instance_id,'00000000-0000-0000-0000-000000000000'::uuid)),language,region)
    do update set raw=metadata_snapshots.raw||excluded.raw,updated_at=now()
    where not (metadata_snapshots.raw @> excluded.raw)`);
}

/** Reuse the shared maintenance transaction and Trakt's catalogue cadence. */
export async function scheduleTraktAirSchedule(tx: Transaction, config: CoastConfig, options: {instanceId?:string;kind?:string;task?:string;force?:boolean;adminId?:string}) {
  const kind='trakt.air-schedule';
  if(!config.enableTrakt||config.features.screen===false||options.kind&&options.kind!==kind||options.task&&!['all','metadata'].includes(options.task))return {queued:0,active:0};
  const [instance]=await tx.execute<{id:string;settings:Record<string,unknown>;completed:Date|null;blocked:boolean}>(sql`
    select i.id,i.settings,
      (select max(a.updated_at) from outbox_actions a where a.kind=${kind} and a.payload->>'instanceId'=i.id::text and a.state='succeeded') as completed,
      exists(select 1 from outbox_actions a where a.kind=${kind} and a.payload->>'instanceId'=i.id::text and a.state in ('pending','running','failed')) as blocked
    from provider_instances i where i.provider='trakt' and i.enabled and i.credentials is not null
      and (${options.instanceId??null}::uuid is null or i.id=${options.instanceId??null}::uuid)
    order by i.id limit 1`);
  if(!instance)return {queued:0,active:0};
  const schedule=providerSchedule('trakt',instance.settings.schedule);
  const task=serviceTasks('trakt').find(item=>item.kinds.includes(kind))!;
  if(!taskSchedulingEnabled('trakt',true,task,schedule,config,options.force))return {queued:0,active:0};
  if(instance.blocked)return {queued:0,active:1};
  if(!options.force&&instance.completed&&Date.now()-new Date(instance.completed).getTime()<schedule.catalogueIntervalMinutes*60_000)return {queued:0,active:0};
  const [admin]=await tx.execute<{id:string}>(sql`select id from users where role='admin' and not disabled
    and coast_job_allowed(id,${kind},'{}'::jsonb) and (${options.adminId??null}::uuid is null or id=${options.adminId??null}::uuid)
    order by created_at,id limit 1`);
  if(!admin)return {queued:0,active:0};
  await tx.execute(sql`insert into outbox_actions(user_id,kind,payload,compaction_key) values(${admin.id},${kind},
    ${{instanceId:instance.id,_manual:!!options.force,_jobPurpose:options.force?'manual':'scheduled'}}::jsonb,${kind})`);
  return {queued:1,active:0};
}

/** An app-level metadata read needs provider credentials and no member account. */
export async function refreshTraktAirSchedule(action: OutboxAction, instanceId: string) {
  const source=await getTraktCommunity(instanceId);
  if(!source)throw new PermanentActionError('Trakt metadata is unavailable.');
  const now=new Date();
  const start=new Date(now.getTime()-86_400_000).toISOString().slice(0,10);
  const calendar=await source.adapter.airSchedule(start);
  await getDb().transaction(async tx=>{
    await lockFeaturePolicyInTransaction(tx,action.userId);
    const [current]=await tx.select().from(providerInstances).where(eq(providerInstances.id,instanceId)).for('update');
    if(!current?.enabled||current.provider!=='trakt'||!current.credentials||!(await getConfig(tx)).enableTrakt||
      `${instanceId}:${createHash('sha256').update(current.credentials).digest('hex')}`!==source.cacheScope)
      throw new PermanentActionError('The Trakt connection changed.');
    await assertJobLease(tx,true);
    await saveTraktAirSchedule(tx,instanceId,calendar);
  });
  return {checked:calendar.length};
}
