import { getSql } from '$lib/server/db';
import { getConfig } from '$lib/server/config';
import { providerSchedule } from './schedule';
import { serviceTasks, maintenanceKinds } from './tasks';

type Settings = { schedule?: unknown; libraryScan?: { connectionId?: string; externalUserId?: string; fullCompletedAt?: string; recentCompletedAt?: string }; sync?: Record<string, boolean>; liveRead?: boolean; collectionProjection?: { enabled?: boolean }; requestsVerifiedAt?: string };
type Instance = { id: string; provider: string; enabled: boolean; settings: Settings; configured: boolean };
type Account = { id: string; instance_id: string; external_user_id: string; settings: Settings; live: boolean; user_completed: Date | null; reviews: number };
type Evidence = { connection_id: string | null; kind: string; instance_id: string | null; completed: Date | null; blocked: boolean };
export type JobTiming = { instanceId: string; kind: string; nextAt: string | null; lastAt: string | null; eligible: number; fresh: number; reviews: number; reason?: string };
/** Scheduling evidence is read independently of the bounded recent-run display. */
export async function jobTimings(): Promise<JobTiming[]> {
  const sql = getSql();
  const config = await getConfig();
  const [instances, accounts, evidence, metadataDue] = await Promise.all([
    sql<Instance[]>`select id,provider,enabled,settings,credentials is not null as configured from provider_instances`,
    sql<Account[]>`select c.id,c.instance_id,c.external_user_id,c.settings,
      exists(select 1 from social_live_state s where s.connection_id=c.id and s.account_generation=c.account_generation and s.expires_at>now())
      or exists(select 1 from playback_sessions p where p.user_id=c.user_id and p.state='active' and p.updated_at>now()-interval '2 minutes')
      or exists(select 1 from social_checkins s where s.user_id=c.user_id and s.state='active' and s.expires_at>now()) as live,
      (select completed_at from sync_checkpoints s where s.connection_id=c.id and s.kind='jellyfin-user') as user_completed,
      (select count(distinct media_id)::int from sync_values s where s.connection_id=c.id and s.conflict) as reviews
      from provider_connections c join users u on u.id=c.user_id where c.status='connected' and not u.disabled order by c.created_at,c.id`,
    sql<Evidence[]>`select c.id as connection_id,k.kind,null::text as instance_id,
      (select a.updated_at from outbox_actions a where a.connection_id=c.id and a.kind=k.kind and a.state='succeeded' and (a.account_generation is null or a.account_generation=c.account_generation) order by a.updated_at desc limit 1) as completed,
      exists(select 1 from outbox_actions a where a.connection_id=c.id and a.kind=k.kind and a.state in ('pending','running','failed') and (a.account_generation is null or a.account_generation=c.account_generation)) as blocked
      from provider_connections c join users u on u.id=c.user_id join provider_instances i on i.id=c.instance_id cross join unnest(${sql.array(maintenanceKinds, 'TEXT')}) as k(kind) where c.status='connected' and not u.disabled
      and (k.kind like i.provider||'.%' or k.kind='catalogue.user-scan' and i.provider in ('jellyfin','trakt'))
      union all select null::uuid,'tmdb.refresh',i.id::text,
      (select updated_at from outbox_actions a where a.kind='tmdb.refresh' and a.payload->>'instanceId'=i.id::text and a.state='succeeded' order by updated_at desc limit 1),
      exists(select 1 from outbox_actions a where a.kind='tmdb.refresh' and a.payload->>'instanceId'=i.id::text and a.state in ('pending','running','failed'))
      from provider_instances i where i.provider='tmdb'`,
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
    ) select instance_id,min(greatest(coalesce(refreshed+make_interval(mins=>interval),now()),coalesce(retry_at::timestamptz,now()))) as due from candidates group by instance_id`,
  ]);
  const result: JobTiming[] = [];
  const tmdb = instances.some(i => i.provider === 'tmdb' && i.enabled && i.configured);
  for (const instance of instances) {
    const schedule = providerSchedule(instance.provider, instance.settings.schedule);
    const linked = accounts.filter(c => c.instance_id === instance.id);
    for (const task of serviceTasks(instance.provider)) {
      const kind = task.kinds[0];
      if (!kind || !task.scope) continue;
      let eligible = linked.filter(c => {
        if (kind === 'catalogue.user-scan') return tmdb;
        if (kind === 'trakt.live') return c.settings.liveRead !== false;
        if (kind === 'trakt.collection-project') return c.settings.collectionProjection?.enabled === true;
        if (kind === 'trakt.lists-import') return c.settings.sync?.lists === true;
        if (kind === 'trakt.import') return ['history','progress','collection','ratings','watchlist'].some(k => c.settings.sync?.[k]);
        return true;
      });
      const library = instance.settings.libraryScan ?? {};
      if (kind === 'jellyfin.library') {
        const selected = schedule.libraryConnectionId ?? library.connectionId;
        const source = eligible.find(c => c.id === selected) ?? (schedule.libraryConnectionId ? undefined : eligible[0]);
        eligible = source ? [source] : [];
      }
      const rows = evidence.filter(e => e.kind === kind && (eligible.some(c => c.id === e.connection_id) || e.instance_id === instance.id));
      const last = rows.map(e => new Date(e.completed ?? 0).getTime()).filter(Boolean);
      const enabled = instance.enabled && schedule.enabled && (!task.enabled || schedule[task.enabled]) && (instance.provider !== 'trakt' || config.enableTrakt) && (instance.provider !== 'seerr' || config.enableRequests);
      const due = eligible.flatMap(c => {
        const entry = rows.find(e => e.connection_id === c.id);
        if (entry?.blocked) return [];
        let completed = new Date(entry?.completed ?? 0).getTime();
        let interval = Number(task.interval ? schedule[task.interval] : 0) * 60000;
        if (kind === 'jellyfin.sync') completed = new Date(c.user_completed ?? 0).getTime();
        if (kind === 'seerr.sync') completed = Date.parse(c.settings.requestsVerifiedAt ?? '') || 0;
        if (kind === 'trakt.live') interval = (c.live ? schedule.liveActiveMinutes : schedule.liveIdleMinutes) * 60000;
        if (kind === 'jellyfin.library') {
          if (library.connectionId !== c.id || library.externalUserId !== c.external_user_id) return [Date.now()];
          const full = Date.parse(library.fullCompletedAt ?? '') || 0;
          const recent = Date.parse(library.recentCompletedAt ?? '') || 0;
          return [Math.min(full + schedule.fullIntervalHours * 3600000, Math.max(full, recent) + interval)];
        }
        return [completed + interval];
      });
      // Metadata is due per record, not one interval after the last batch.
      const fresh = eligible.filter(c => { const completed = kind === 'jellyfin.sync' ? c.user_completed : rows.find(e => e.connection_id === c.id)?.completed; return completed && Date.now() - new Date(completed).getTime() <= Number(task.interval ? schedule[task.interval] : 0) * 120000; }).length;
      const metadataAt = metadataDue.find(entry => entry.instance_id === instance.id)?.due;
      const metadata = kind === 'tmdb.refresh';
      result.push({ instanceId: instance.id, kind,
        nextAt: enabled && (metadata ? instance.configured && metadataAt && !rows.some(e => e.blocked) : due.length) ? new Date(Math.max(Date.now(), metadata ? new Date(metadataAt!).getTime() : Math.min(...due))).toISOString() : null,
        lastAt: last.length ? new Date(Math.max(...last)).toISOString() : null,
        fresh, eligible: metadata ? Number(instance.configured) : eligible.length,
        reviews: kind === 'jellyfin.sync' || kind === 'trakt.import' ? eligible.reduce((sum,c) => sum + c.reviews,0) : 0,
        reason: !enabled ? 'Automatic runs paused' : !metadata && !eligible.length ? 'No eligible connected accounts' : metadata && !metadataAt ? 'No shared records to refresh' : !metadata && !due.length ? 'Waiting for current work or account attention' : undefined,
      });
    }
  }
  return result;
}
