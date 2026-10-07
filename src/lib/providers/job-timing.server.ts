import { getSql } from '$lib/server/db';
import { getConfig } from '$lib/server/config';
import { providerSchedule } from './schedule';
import { serviceTasks, maintenanceKinds } from './tasks';
import { jobIdentityScope } from './job-policy';
import { eligibleTaskAccounts, recurringTask, taskDue, taskSchedulingEnabled, type TaskSettings } from './task-timing';

type Settings = TaskSettings;
type Instance = { id: string; provider: string; enabled: boolean; settings: Settings; configured: boolean };
type Account = { account_generation:string; role:string; id: string; instance_id: string; external_user_id: string; settings: Settings; configured: boolean; live: boolean; user_completed: Date | null; reviews: number };
type Evidence = { connection_id: string | null; kind: string; instance_id: string | null; completed: Date | null; blocked: boolean; latest_state: string | null };
export type LastJobRun = {id:string;state:'succeeded'|'failed'|'cancelled';at:string;outcome:import('$lib/server/queue').JobOutcome|null;lastError:string|null};
export type JobTiming = {lastRun?:LastJobRun|null; completed?:number; instanceId: string; kind: string; nextAt: string | null; lastAt: string | null; eligible: number; fresh: number; reviews: number; reason?: string };
/** Scheduling evidence is read independently of the bounded recent-run display. */
export async function jobTimings(): Promise<JobTiming[]> {
  const sql = getSql();
  const config = await getConfig();
  const [instances, accounts, evidence, metadataDue, lastRuns] = await Promise.all([
    sql<Instance[]>`select id,provider,enabled,settings,credentials is not null as configured from provider_instances`,
    sql<Account[]>`select c.id,c.instance_id,c.account_generation,c.external_user_id,c.settings,u.role,c.credentials is not null as configured,
      exists(select 1 from social_live_state s where s.connection_id=c.id and s.account_generation=c.account_generation and s.expires_at>now())
      or exists(select 1 from playback_sessions p where p.user_id=c.user_id and p.state='active' and p.updated_at>now()-interval '2 minutes')
      or exists(select 1 from social_checkins s where s.user_id=c.user_id and s.state='active' and s.expires_at>now()) as live,
      (select completed_at from sync_checkpoints s where s.connection_id=c.id and s.kind='jellyfin-user') as user_completed,
      (select count(distinct media_id)::int from sync_values s where s.connection_id=c.id and s.conflict) as reviews
      from provider_connections c join users u on u.id=c.user_id where c.status='connected' and not u.disabled order by c.created_at,c.id`,
    sql<Evidence[]>`select c.id as connection_id,k.kind,null::text as instance_id,
      (select a.updated_at from outbox_actions a where a.connection_id=c.id and a.kind=k.kind and a.state='succeeded' and (a.account_generation is null or a.account_generation=c.account_generation) order by a.updated_at desc limit 1) as completed,
      (select a.state from outbox_actions a where a.connection_id=c.id and a.kind=k.kind and (a.account_generation is null or a.account_generation=c.account_generation) order by a.created_at desc,a.id desc limit 1) as latest_state,
      exists(select 1 from outbox_actions a where a.connection_id=c.id and a.kind=k.kind and a.state in ('pending','running','failed') and (a.account_generation is null or a.account_generation=c.account_generation)) as blocked
      from provider_connections c join users u on u.id=c.user_id join provider_instances i on i.id=c.instance_id cross join unnest(${sql.array(maintenanceKinds, 'TEXT')}) as k(kind) where c.status='connected' and not u.disabled
      and (k.kind like i.provider||'.%' or k.kind='catalogue.user-scan' and i.provider in ('jellyfin','trakt'))
      union all select null::uuid,k.kind,i.id::text,
      (select updated_at from outbox_actions a where a.kind=k.kind and a.payload->>'instanceId'=i.id::text and a.state='succeeded' order by updated_at desc limit 1),null::text,
      exists(select 1 from outbox_actions a where a.kind=k.kind and a.payload->>'instanceId'=i.id::text and a.state in ('pending','running','failed'))
      from provider_instances i cross join lateral unnest(case when i.provider='tmdb' then ARRAY['tmdb.refresh','tmdb.recommendations'] else ARRAY['igdb.recommendations'] end) as k(kind) where i.provider in ('tmdb','igdb')`,
    sql<{ instance_id: string; due: Date | null }[]>`with pool as materialized (
      select e.media_id,coalesce(s.region,'GB') as region,
        max(s.updated_at) filter(where s.raw->>'detailLoaded'='true') as refreshed,
        max(s.raw->>'maintenanceRetryAt') as retry_at
      from (select distinct media_id from external_ids where provider='tmdb' and media_kind in ('movie','show','collection')) e
      left join metadata_snapshots s on s.media_id=e.media_id and s.provider='tmdb'
      group by e.media_id,s.region
    ), candidates as (
      select i.id as instance_id,p.*,
        coalesce((i.settings->'schedule'->>'intervalMinutes')::int,10080) as interval
      from provider_instances i cross join pool p
      where i.provider='tmdb' and i.enabled and i.credentials is not null
        and coalesce((i.settings->'schedule'->>'enabled')::boolean,true)
    ) select instance_id,min(greatest(case when exists(select 1 from works w where w.id=candidates.media_id and w.kind in ('movie','show') and not exists(select 1 from work_features f where f.work_id=w.id and f.provider='tmdb')) then now() else coalesce(refreshed+make_interval(mins=>interval),now()) end,coalesce(retry_at::timestamptz,now()))) as due from candidates group by instance_id`,
    sql<{instance_id:string;kind:string;id:string;state:LastJobRun['state'];at:Date;outcome:LastJobRun['outcome'];last_error:string|null}[]>`with latest as (
      select c.instance_id,a.kind,a.id,a.state,a.updated_at as at,a.payload->'_jobOutcome' as outcome,a.last_error
      from provider_connections c cross join unnest(${sql.array([...new Set(['jellyfin','trakt','steam','seerr','tmdb','igdb'].flatMap(provider=>serviceTasks(provider).flatMap(task=>task.kinds)))], 'TEXT')}) k(kind)
      join lateral(select * from outbox_actions a where a.connection_id=c.id and a.kind=k.kind and a.state in ('succeeded','failed','cancelled') and (a.account_generation is null or a.account_generation=c.account_generation) order by a.updated_at desc,a.id desc limit 1) a on true
      union all select i.id,a.kind,a.id,a.state,a.updated_at,a.payload->'_jobOutcome',a.last_error
      from provider_instances i cross join unnest(ARRAY['tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata']) k(kind)
      join lateral(select * from outbox_actions a where a.connection_id is null and a.kind=k.kind and a.kind like i.provider||'.%' and a.payload->>'instanceId'=i.id::text and a.state in ('succeeded','failed','cancelled') order by a.updated_at desc,a.id desc limit 1) a on true
    ) select distinct on(instance_id,kind) * from latest order by instance_id,kind,at desc,id desc`,
  ]);
  const result: JobTiming[] = [];
  const now = Date.now();
  const tmdb = instances.some(i => i.provider === 'tmdb' && i.enabled && i.configured);
  for (const instance of instances) {
    const schedule = providerSchedule(instance.provider, instance.settings.schedule);
    const linked = accounts.filter(c => c.instance_id === instance.id);
    const bridge=instance.settings.companion;
    const validSource=linked.some(c=>c.id===bridge?.connectionId&&c.account_generation===bridge.generation&&c.role==='admin');
    const effectiveSettings=validSource?instance.settings:{...instance.settings,companion:undefined};
    for (const task of serviceTasks(instance.provider)) {
      const kind = task.kinds[0];
      if (!kind) continue;
      if(!task.scope){result.push({instanceId:instance.id,kind,nextAt:null,lastAt:null,eligible:0,fresh:0,reviews:0,reason:'Requested by a user action'});continue;}
      const eligible = eligibleTaskAccounts(kind, linked.map(account => ({ ...account,
        externalUserId: account.external_user_id, userCompleted: account.user_completed,
      })), schedule, instance.settings, tmdb);
      const shared = jobIdentityScope(kind) === 'instance';
      const rows = evidence.filter(entry => entry.kind === kind && (shared
        ? linked.some(account => account.id === entry.connection_id) || entry.instance_id === instance.id
        : eligible.some(account => account.id === entry.connection_id)));
      const enabled = taskSchedulingEnabled(instance.provider, instance.enabled, task, schedule, config) && (kind !== 'trakt.recommendations' || instance.configured);
      const last = rows.map(entry => new Date(entry.completed ?? 0).getTime()).filter(Boolean);
      const sharedEvidence = { blocked: rows.some(entry => entry.blocked), completed: last.length ? new Date(Math.max(...last)) : null };
      const accountDue = eligible.map(account => ({ account, due: taskDue(task, schedule, effectiveSettings, account,
        shared ? sharedEvidence : rows.find(entry => entry.connection_id === account.id) ?? {}, now) }));
      const due = accountDue.flatMap(entry => entry.due.at == null ? [] : [entry.due.at]);
      const completed = eligible.filter(account=>rows.find(entry=>entry.connection_id===account.id)?.latest_state==='succeeded').length;
      const fresh = accountDue.filter(({ due }) => due.completed > 0 && now - due.completed <= due.interval * 2).length;
      const metadataAt = metadataDue.find(entry => entry.instance_id === instance.id)?.due;
      const metadata = kind === 'tmdb.refresh';
      const sharedRecommendations = ['tmdb.recommendations', 'igdb.recommendations'].includes(kind);
      if (sharedRecommendations) {
        const latest = last.length ? Math.max(...last) : 0;
        result.push({ instanceId: instance.id, kind,
          nextAt: enabled && instance.configured && !sharedEvidence.blocked ? new Date(Math.max(now, taskDue(task, schedule, instance.settings, { id: instance.id, externalUserId: null, role: 'admin', settings: {} }, sharedEvidence, now).at!)).toISOString() : null,
          lastAt: latest ? new Date(latest).toISOString() : null, eligible: Number(instance.configured), fresh: 0, reviews: 0,
          reason: !enabled ? 'Automatic runs paused' : !instance.configured ? 'Service credentials required' : sharedEvidence.blocked ? 'Waiting for current work or account attention' : undefined });
        continue;
      }
      result.push({ instanceId: instance.id, kind,
        nextAt: enabled && (metadata ? instance.configured && metadataAt && !sharedEvidence.blocked : due.length)
          ? new Date(Math.max(now, metadata ? new Date(metadataAt!).getTime() : Math.min(...due))).toISOString() : null,
        lastAt: last.length ? new Date(Math.max(...last)).toISOString() : null,
        fresh, completed, eligible: metadata ? Number(instance.configured) : eligible.length,
        reviews: kind === 'jellyfin.sync' || kind === 'trakt.import' ? eligible.reduce((sum, account) => sum + account.reviews, 0) : 0,
        reason: !recurringTask(kind) ? 'Requested when an account connects' : !enabled ? 'Automatic runs paused'
          : !metadata && !eligible.length ? 'No eligible connected accounts'
          : metadata && !metadataAt ? 'No shared records to refresh'
          : (metadata && sharedEvidence.blocked || !metadata && !due.length) ? (effectiveSettings.companion?.status==='healthy'&&['jellyfin.live','jellyfin.streams'].includes(kind)?'Handled by plugin updates':'Waiting for current work or account attention') : undefined,
      });
    }
  }
  for(const timing of result){
    const run=lastRuns.find(run=>run.instance_id===timing.instanceId&&run.kind===timing.kind);
    timing.lastRun=run?{id:run.id,state:run.state,at:new Date(run.at).toISOString(),outcome:run.outcome,lastError:run.last_error}:null;
  }
  return config.developerMode?result.map(timing=>({...timing,nextAt:null,reason:'Developer mode · automatic runs paused'})):result;
}
