import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
  externalIds,
  providerConnections,
  providerInstances,
  providerItems,
  metadataSnapshots,
  media,
} from '$lib/server/db/schema';
import { ingestMetadata, refreshMedia } from './service';
import { getTrakt } from '$lib/providers/trakt/connection.server';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import type {
  TraktAdapter,
  TraktRecord,
} from '$lib/providers/trakt/adapter.server';
import type { JellyfinAdapter } from '$lib/providers/jellyfin/adapter.server';
import type { DiscoverKind } from '$lib/providers/contracts';
import { ProviderHttpError } from '$lib/server/security/provider-fetch';
import { providerSchedule } from '$lib/providers/schedule';
import { PermanentActionError, type OutboxAction } from '$lib/server/queue';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** Metadata only: a remote relationship never becomes a local personal relationship here. */
export async function persistMissingTmdb(
  kind: DiscoverKind,
  id: string,
  reference?: { title: string; externalIds?: Record<string, string> }
) {
  if (!/^[1-9]\d*$/.test(id)) return false;
  const [existing] = await getDb()
    .select({ id: externalIds.mediaId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.provider, 'tmdb'),
        eq(externalIds.mediaKind, kind),
        eq(externalIds.externalId, id)
      )
    )
    .limit(1);
  if (existing) return false;
  // Persist the verified reference first. The shared refresh task fills full TMDB
  // details, so account scans never share TMDB credentials, cooldowns or retries.
  await ingestMetadata({
    provider: 'tmdb',
    externalId: id,
    kind,
    title: reference?.title || 'Untitled',
    externalIds: reference?.externalIds,
  });
  return true;
}

export async function scanTraktCatalogue(
  adapter: TraktAdapter,
  save = persistMissingTmdb
) {
  const seen = new Set<string>();
  const consume = async (record: TraktRecord) => {
    const item = record.movie ?? record.show;
    if (!item?.ids.tmdb) return;
    const key = `${record.movie ? 'movie' : 'show'}:${item.ids.tmdb}`;
    if (seen.has(key)) return;
    if (seen.size >= 10000) seen.delete(seen.values().next().value!);
    seen.add(key);
    await save(record.movie ? 'movie' : 'show', String(item.ids.tmdb), {
      title: item.title || 'Untitled',
      externalIds: Object.fromEntries(
        Object.entries(item.ids)
          .filter(
            ([key, value]) =>
              ['trakt', 'imdb', 'tvdb'].includes(key) && value != null
          )
          .map(([key, value]) => [key, String(value)])
      ),
    });
  };
  for (const category of [
    'history',
    'progress',
    'collection',
    'ratings',
    'watchlist',
  ] as const) {
    for (let page = 1; ; page++) {
      const records = await adapter.read(category, page);
      for (const record of records) await consume(record);
      if (records.length < 100) break;
      if (page >= 10000)
        throw new Error(
          'Trakt catalogue scan exceeded the supported page bound.'
        );
    }
  }
  for (const record of await adapter.collectionShows()) await consume(record);
  for (const list of await adapter.lists())
    for (const record of await adapter.listItems(String(list.ids.trakt)))
      await consume(record);
}

export async function scanJellyfinCatalogue(
  adapter: JellyfinAdapter,
  externalUserId: string,
  save = persistMissingTmdb,
  resolvedRoots: (ids: string[]) => Promise<Set<string>> = async () => new Set()
) {
  let offset = 0;
  const seen = new Set<string>();
  for (;;) {
    const page = await adapter.library(
      externalUserId,
      offset,
      undefined,
      'user'
    );
    const roots = new Set<string>();
    for (const item of page.items) {
      if (
        !item.userData ||
        !(
          item.userData.played ||
          item.userData.playCount > 0 ||
          item.userData.positionSeconds > 0 ||
          item.userData.favourite
        )
      )
        continue;
      const rootId =
        item.kind === 'movie' || item.kind === 'show' ? item.id : item.showId;
      if (!rootId || seen.has(rootId)) continue;
      if (seen.size >= 10000) seen.delete(seen.values().next().value!);
      seen.add(rootId);
      roots.add(rootId);
    }
    const resolved = roots.size ? await resolvedRoots([...roots]) : new Set<string>();
    for (const rootId of roots) {
      if (resolved.has(rootId)) continue;
      const root = await adapter.item(externalUserId, rootId);
      const id = root.metadata.externalIds?.tmdb;
      if (id && (root.kind === 'movie' || root.kind === 'show'))
        await save(root.kind, id, {
          title: root.metadata.title,
          externalIds: root.metadata.externalIds,
        });
    }
    if (page.nextOffset === null) return;
    if (page.nextOffset <= offset)
      throw new Error('Jellyfin returned an incomplete library page.');
    offset = page.nextOffset;
  }
}

/** Canonical metadata is shared, but remote item IDs remain instance-specific. */
export async function resolvedJellyfinCatalogueRoots(instanceId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const resolved = await getDb()
    .selectDistinct({ id: providerItems.externalId })
    .from(providerItems)
    .innerJoin(externalIds, and(
      eq(externalIds.mediaId, providerItems.mediaId),
      eq(externalIds.provider, 'tmdb'),
      eq(externalIds.mediaKind, providerItems.kind)
    ))
    .where(and(
      eq(providerItems.instanceId, instanceId),
      inArray(providerItems.externalId, ids),
      inArray(providerItems.kind, ['movie', 'show'])
    ));
  return new Set(resolved.map((item) => item.id));
}

export async function scanUserCatalogue(action: OutboxAction) {
  if (!action.connectionId) return;
  const [tmdb] = await getDb()
    .select({ id: providerInstances.id })
    .from(providerInstances)
    .where(
      and(
        eq(providerInstances.provider, 'tmdb'),
        eq(providerInstances.enabled, true),
        sql`${providerInstances.credentials} is not null`
      )
    )
    .limit(1);
  if (!tmdb) return;
  const [instance] = await getDb()
    .select({ id: providerInstances.id, provider: providerInstances.provider })
    .from(providerInstances)
    .innerJoin(
      providerConnections,
      eq(providerConnections.instanceId, providerInstances.id)
    )
    .where(eq(providerConnections.id, action.connectionId));
  let added = 0;
  const save: typeof persistMissingTmdb = async (...args) => { const created = await persistMissingTmdb(...args); if (created) added++; return created; };
  if (instance?.provider === 'trakt') {
    const { adapter } = await getTrakt(action.userId, action.connectionId);
    await scanTraktCatalogue(adapter, save);
  } else if (instance?.provider === 'jellyfin') {
    const { adapter, connection } = await getJellyfin(
      action.userId,
      action.connectionId
    );
    await scanJellyfinCatalogue(adapter, connection.externalUserId!, save,
      (ids) => resolvedJellyfinCatalogueRoots(instance.id, ids));
  }
  return { added };
}

/** Shared batches use one durable job; item failures retain retry state in their metadata snapshot. */
async function metadataCandidates(
  db: Tx | ReturnType<typeof getDb>,
  interval: number,
  force = false
) {
  return db.execute<{ id: string; region: string }>(sql`
    with identities as (
      select distinct media_id as id from external_ids where provider='tmdb' and media_kind in ('movie','show','collection')
    ), candidates as (
      select i.id,coalesce(s.region,'GB') as region,
        max(s.updated_at) filter(where s.raw->>'detailLoaded'='true') as refreshed,
        max(s.raw->>'maintenanceRetryAt') as retry_at
      from identities i left join metadata_snapshots s on s.media_id=i.id and s.provider='tmdb'
      group by i.id,s.region
    ) select id,region from candidates
    where (${force} or refreshed is null or exists(select 1 from works w where w.id=candidates.id and w.kind in ('movie','show') and not exists(select 1 from work_features f where f.work_id=w.id and f.provider='tmdb')) or refreshed < now()-make_interval(mins=>${interval}))
      and (${force} or retry_at is null or retry_at::timestamptz<=now())
    order by refreshed nulls first,id,region limit 100
  `);
}

export async function scheduleMetadataRefresh(
  tx: Tx,
  options: {
    instanceId?: string;
    force?: boolean;
    task?: string;
    kind?:string;
    adminId?: string;
  }
) {
  if (options.kind && options.kind!=='tmdb.refresh' || options.task && !['all', 'metadata'].includes(options.task))
    return { queued: 0, active: 0 };
  const [instance] = await tx.execute<{
    id: string;
    settings: Record<string, unknown>;
  }>(sql`
    select id,settings from provider_instances where provider='tmdb' and enabled and credentials is not null
    and (${options.instanceId ?? null}::uuid is null or id=${options.instanceId ?? null}::uuid) order by id limit 1
  `);
  if (!instance) return { queued: 0, active: 0 };
  const schedule = providerSchedule('tmdb', instance.settings.schedule);
  if (!options.force && !schedule.enabled) return { queued: 0, active: 0 };
  const [existing] = await tx.execute<{ id: string }>(
    sql`select id from outbox_actions where kind='tmdb.refresh' and payload->>'instanceId'=${instance.id} and state in ('pending','running','failed') limit 1`
  );
  if (existing) {
    if(options.force)await tx.execute(sql`update outbox_actions set payload=payload||'{"_manual":true}'::jsonb where id=${existing.id} and state='pending'`);
    return { queued: 0, active: 1 };
  }
  const [admin] = await tx.execute<{ id: string }>(
    sql`select id from users where role='admin' and not disabled and (${options.adminId ?? null}::uuid is null or id=${options.adminId ?? null}::uuid) order by created_at,id limit 1`
  );
  if (
    !admin ||
    !(await metadataCandidates(tx, schedule.intervalMinutes, !!options.force))
      .length
  )
    return { queued: 0, active: 0 };
  await tx.execute(
    sql`insert into outbox_actions(user_id,kind,payload,compaction_key) values(${admin.id},'tmdb.refresh',${{ instanceId: instance.id, force: !!options.force,_manual:!!options.force }}::jsonb,'tmdb.refresh')`
  );
  return { queued: 1, active: 0 };
}

async function metadataFailure(id: string, region: string) {
  const db = getDb();
  const [item] = await db
    .select({ title: media.title })
    .from(media)
    .where(eq(media.id, id));
  if (!item) return;
  const retryAt = new Date(Date.now() + 86400000).toISOString();
  await db
    .insert(metadataSnapshots)
    .values({
      mediaId: id,
      provider: 'tmdb',
      language: 'en-US',
      region,
      title: item.title,
      raw: { maintenanceRetryAt: retryAt },
    })
    .onConflictDoNothing();
  await db
    .update(metadataSnapshots)
    .set({
      raw: sql`jsonb_set(${metadataSnapshots.raw},'{maintenanceRetryAt}',${JSON.stringify(retryAt)}::jsonb,true)`,
    })
    .where(
      and(
        eq(metadataSnapshots.mediaId, id),
        eq(metadataSnapshots.provider, 'tmdb'),
        eq(metadataSnapshots.region, region)
      )
    );
}

export async function refreshSharedMetadata(
  action: OutboxAction,
  refresh = refreshMedia
) {
  const db = getDb();
  const [instance] = await db
    .select()
    .from(providerInstances)
    .where(
      and(
        eq(providerInstances.id, String(action.payload.instanceId)),
        eq(providerInstances.provider, 'tmdb'),
        eq(providerInstances.enabled, true)
      )
    );
  if (!instance?.credentials)
    throw new PermanentActionError('TMDB is unavailable.');
  const candidates = await metadataCandidates(
    db,
    providerSchedule('tmdb', instance.settings.schedule).intervalMinutes,
    action.payload.force === true
  );
  let processed = 0,
    failed = 0;
  const startedAt = new Date().toISOString();
  async function progress() {
    await db
      .update(providerInstances)
      .set({
        settings: sql`jsonb_set(${providerInstances.settings},'{metadataScan}',${{ startedAt, processed, total: candidates.length, failed, phase: failed ? `${failed} records deferred for retry` : 'Refreshing metadata' }}::jsonb,true)`,
      })
      .where(eq(providerInstances.id, instance!.id));
  }
  await progress();
  let next = 0,
    fatal: unknown;
  async function worker() {
    while (next < candidates.length && !fatal) {
      const item = candidates[next++];
      try {
        await refresh(item.id, item.region, false);
      } catch (error) {
        if (
          !(
            error instanceof ProviderHttpError &&
            [400, 404, 409, 410, 422].includes(error.status)
          ) &&
          !(
            error instanceof Error &&
            error.message ===
              'Conflicting provider identities require administrator review.'
          )
        )
          throw error;
        await metadataFailure(item.id, item.region);
        failed++;
      }
      processed++;
      if (processed % 10 === 0) await progress();
    }
  }
  // Await both workers, including in-flight reads, before releasing the service lock.
  await Promise.all([
    worker().catch((error) => {
      fatal ??= error;
    }),
    worker().catch((error) => {
      fatal ??= error;
    }),
  ]);
  await progress();
  if (fatal) throw fatal;
  return { refreshed: processed - failed, deferred: failed };
}
