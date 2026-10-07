import { and, eq, inArray, sql } from 'drizzle-orm';
import * as v from 'valibot';
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
import { readJobCheckpoint, saveJobCheckpoint, jobCheckpoint } from '$lib/server/queue/execution';

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

const pageNumber = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10000));
const traktCursorSchema = v.object({
  stage: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(7)),
  page: pageNumber,
  listIds: v.pipe(v.array(v.string()), v.maxLength(100)),
  listIndex: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)),
  itemsPage: pageNumber,
});
const jellyfinCursorSchema = v.object({
  filter: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3)),
  offset: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000000)),
});
type TraktCatalogueCursor = v.InferOutput<typeof traktCursorSchema>;
type JellyfinCatalogueCursor = v.InferOutput<typeof jellyfinCursorSchema>;
type ScanProgress<Cursor> = { cursor?: Cursor; committed?: (cursor: Cursor) => Promise<void> };

/** A cursor advances only after every positive reference in its page is saved.
 * Replay is harmless: missing metadata insertion is identity-idempotent. */
export async function scanTraktCatalogue(
  adapter: TraktAdapter,
  save = persistMissingTmdb,
  progress: ScanProgress<TraktCatalogueCursor> = {}
) {
  let cursor = progress.cursor ? v.parse(traktCursorSchema, progress.cursor) : {
    stage: 0, page: 1, listIds: [], listIndex: 0, itemsPage: 1,
  };
  const seen = new Set<string>();
  const consume = async (records: TraktRecord[], limit = 100) => {
    if (records.length > limit) throw new Error('Trakt returned an oversized catalogue page.');
    for (const record of records) {
      const item = record.movie ?? record.show;
      if (!item?.ids.tmdb) continue;
      const kind = record.movie ? 'movie' : 'show';
      const key = `${kind}:${item.ids.tmdb}`;
      if (seen.has(key)) continue;
      if (seen.size >= 10000) seen.delete(seen.values().next().value!);
      seen.add(key);
      await save(kind, String(item.ids.tmdb), {
        title: item.title || 'Untitled',
        externalIds: Object.fromEntries(
          Object.entries(item.ids)
            .filter(([key, value]) => ['trakt', 'imdb', 'tvdb'].includes(key) && value != null)
            .map(([key, value]) => [key, String(value)])
        ),
      });
    }
  };
  const advance = async (next: TraktCatalogueCursor) => {
    cursor = v.parse(traktCursorSchema, next);
    await progress.committed?.(cursor);
  };
  const nextPage = (page: number) => {
    if (page >= 10000) throw new Error('Trakt catalogue scan exceeded the supported page bound.');
    return page + 1;
  };
  const categories = ['history', 'progress', 'collection', 'ratings', 'watchlist'] as const;
  while (cursor.stage < 6) {
    const records = cursor.stage < 5
      ? await adapter.read(categories[cursor.stage], cursor.page)
      : await adapter.collectionShowsPage(cursor.page);
    await consume(records, cursor.stage === 5 ? 10 : 100);
    const complete = records.length < (cursor.stage === 5 ? 10 : 100);
    await advance({ ...cursor, stage: cursor.stage + Number(complete), page: complete ? 1 : nextPage(cursor.page) });
  }
  while (cursor.stage === 6) {
    if (!cursor.listIds.length) {
      const lists = await adapter.listsPage(cursor.page);
      if (!lists.length) { await advance({ ...cursor, stage: 7 }); break; }
      // Keep only one bounded list page in the job payload, never its item inventory.
      await advance({ ...cursor, listIds: lists.map(list => String(list.ids.trakt)), listIndex: 0, itemsPage: 1 });
    }
    while (cursor.listIndex < cursor.listIds.length) {
      const records = await adapter.listItemsPage(cursor.listIds[cursor.listIndex], cursor.itemsPage);
      await consume(records);
      const complete = records.length < 100;
      await advance({ ...cursor, listIndex: cursor.listIndex + Number(complete), itemsPage: complete ? 1 : nextPage(cursor.itemsPage) });
    }
    const complete = cursor.listIds.length < 100;
    await advance({ ...cursor, stage: complete ? 7 : 6, page: complete ? 1 : nextPage(cursor.page), listIds: [], listIndex: 0, itemsPage: 1 });
  }
}

export async function scanJellyfinCatalogue(
  adapter: JellyfinAdapter,
  externalUserId: string,
  save = persistMissingTmdb,
  resolvedRoots: (ids: string[]) => Promise<Set<string>> = async () => new Set(),
  progress: ScanProgress<JellyfinCatalogueCursor> = {}
) {
  let cursor = progress.cursor ? v.parse(jellyfinCursorSchema, progress.cursor) : { filter: 0, offset: 0 };
  const filters = ['IsPlayed', 'IsResumable', 'IsFavorite'] as const;
  const seen = new Set<string>();
  while (cursor.filter < filters.length) {
    const page = await adapter.library(externalUserId, cursor.offset, undefined, 'user', filters[cursor.filter]);
    const roots = new Set<string>();
    for (const item of page.items) {
      if (!item.userData || !(item.userData.played || item.userData.playCount > 0 || item.userData.positionSeconds > 0 || item.userData.favourite)) continue;
      const rootId = item.kind === 'movie' || item.kind === 'show' ? item.id : item.showId;
      if (!rootId || seen.has(rootId)) continue;
      if (seen.size >= 10000) seen.delete(seen.values().next().value!);
      seen.add(rootId);
      roots.add(rootId);
    }
    const resolved = roots.size ? await resolvedRoots([...roots]) : new Set<string>();
    const missing = [...roots].filter(id => !resolved.has(id));
    // The authenticated Items endpoint returns accessible matches and can omit
    // individually unavailable roots. Shared mappings need no provider read.
    for (let start = 0; start < missing.length; start += 100) {
      for (const root of await adapter.items(externalUserId, missing.slice(start, start + 100))) {
        const id = root.metadata.externalIds?.tmdb;
        if (id && (root.kind === 'movie' || root.kind === 'show'))
          await save(root.kind, id, { title: root.metadata.title, externalIds: root.metadata.externalIds });
      }
    }
    if (page.nextOffset !== null && page.nextOffset <= cursor.offset)
      throw new Error('Jellyfin returned an incomplete library page.');
    cursor = v.parse(jellyfinCursorSchema, page.nextOffset === null
      ? { filter: cursor.filter + 1, offset: 0 }
      : { filter: cursor.filter, offset: page.nextOffset });
    await progress.committed?.(cursor);
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
  const checkpoint = await readJobCheckpoint();
  const addedSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
  let added = checkpoint ? v.parse(addedSchema, checkpoint.added) : 0;
  const save: typeof persistMissingTmdb = async (...args) => {
    const created = await persistMissingTmdb(...args);
    if (created) added++;
    return created;
  };
  const committed = async (cursor: TraktCatalogueCursor | JellyfinCatalogueCursor) => {
    await saveJobCheckpoint({ task: 'user-catalogue', provider: instance?.provider, cursor, added });
    await jobCheckpoint();
  };
  if (checkpoint && (checkpoint.task !== 'user-catalogue' || checkpoint.provider !== instance?.provider))
    throw new PermanentActionError('The catalogue scan account changed.');
  if (instance?.provider === 'trakt') {
    const { adapter } = await getTrakt(action.userId, action.connectionId);
    await scanTraktCatalogue(adapter, save, {
      cursor: checkpoint ? v.parse(traktCursorSchema, checkpoint.cursor) : undefined, committed,
    });
  } else if (instance?.provider === 'jellyfin') {
    const { adapter, connection } = await getJellyfin(action.userId, action.connectionId);
    await scanJellyfinCatalogue(adapter, connection.externalUserId!, save,
      (ids) => resolvedJellyfinCatalogueRoots(instance.id, ids), {
        cursor: checkpoint ? v.parse(jellyfinCursorSchema, checkpoint.cursor) : undefined, committed,
      });
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
    if(options.force)await tx.execute(sql`update outbox_actions set payload=payload
        || jsonb_build_object('_manual',true,'_jobPurpose',case when payload->>'_jobPurpose' in ('playback','bootstrap','interactive') then payload->>'_jobPurpose' else 'manual' end)
        || case when state='pending' then '{"force":true}'::jsonb else '{}'::jsonb end,updated_at=now()
      where id=${existing.id} and state in ('pending','running')`);
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
    sql`insert into outbox_actions(user_id,kind,payload,compaction_key) values(${admin.id},'tmdb.refresh',${{ instanceId: instance.id, force: !!options.force,_manual:!!options.force,_jobPurpose:options.force?'manual':'scheduled' }}::jsonb,'tmdb.refresh')`
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
  const checkpointSchema=v.object({task:v.literal('tmdb-refresh'),instanceId:v.pipe(v.string(),v.uuid()),
    items:v.array(v.object({id:v.pipe(v.string(),v.uuid()),region:v.string()})),next:v.pipe(v.number(),v.integer(),v.minValue(0)),
    failed:v.pipe(v.number(),v.integer(),v.minValue(0)),startedAt:v.pipe(v.string(),v.isoTimestamp())});
  const saved=await readJobCheckpoint();
  const checkpoint=saved?v.parse(checkpointSchema,saved):null;
  if(checkpoint&&checkpoint.instanceId!==instance.id)throw new PermanentActionError('The metadata source changed.');
  const candidates=checkpoint?.items ?? (await metadataCandidates(db,
    providerSchedule('tmdb',instance.settings.schedule).intervalMinutes,action.payload.force===true)).map(({id,region})=>({id,region}));
  let processed=checkpoint?.next ?? 0,failed=checkpoint?.failed ?? 0;
  const startedAt=checkpoint?.startedAt ?? new Date().toISOString();
  async function retain(){
    await saveJobCheckpoint({task:'tmdb-refresh',instanceId:instance!.id,items:candidates,next:processed,failed,startedAt});
    await db.update(providerInstances).set({settings:sql`jsonb_set(${providerInstances.settings},'{metadataScan}',
      ${{startedAt,processed,total:candidates.length,failed,phase:failed?`${failed} records deferred for retry`:'Refreshing metadata'}}::jsonb,true)`})
      .where(eq(providerInstances.id,instance!.id));
  }
  await retain();
  for(const item of candidates.slice(processed)){
    try{await refresh(item.id,item.region,false);}
    catch(error){
      if(!(error instanceof ProviderHttpError&&[400,404,409,410,422].includes(error.status))&&
        !(error instanceof Error&&error.message==='Conflicting provider identities require administrator review.'))throw error;
      await metadataFailure(item.id,item.region);failed++;
    }
    processed++;
    // The finite batch is retained even for forced refreshes, so a yield cannot
    // select the same first records again or skip the rest as timestamps change.
    await retain();
    await jobCheckpoint();
  }
  return {refreshed:processed-failed,deferred:failed};
}
