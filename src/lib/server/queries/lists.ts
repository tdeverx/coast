import type { MediaView, MediaCardPresentation } from '$lib/ui/types';
import { workCards } from '$lib/collection/query.server';
import { getConfig } from '../config';
import { and, or, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../db';
import * as s from '../db/schema';
import { AppError } from '../security/errors';
import { getLists } from '../../core/lists/service';
import { hasPermittedMediaSource, applySequenceEntry } from './media';
import { sequenceEntries } from '../../core/lists/sequence';
import { viewingRecency } from './viewing-recency';
import { pageNumberSchema, PAGE_SIZE, pagination } from './pagination';

const uuidSchema = v.pipe(v.string(), v.uuid());

export const listsOptionsSchema = v.object({
  category:v.optional(v.picklist(['all','screen','game','music']),'all'),
  view: v.optional(v.union([v.picklist(['watchlist', 'favourites']), uuidSchema]), 'watchlist'),
  filter: v.optional(
    v.picklist(['to-watch', 'progress', 'complete', 'dropped', 'all']),
    'to-watch'
  ),
  scope: v.optional(v.picklist(['all', 'available']), 'all'),
  page: v.optional(pageNumberSchema, 1),
  kind: v.optional(v.picklist(['all', 'movie', 'show', 'album', 'track', 'game']), 'all'),
});

/** Read list summaries, then hydrate only the selected list's visible page. */
export async function listsData(userId: string, rawOptions: unknown = {}, viewerId = userId) {
  v.parse(uuidSchema, userId);
  const input = v.parse(listsOptionsSchema, rawOptions);
  const db = getDb();
  const lists = (await getLists(userId)).sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id)
  );
  const selected = lists.find((list) => list.id === input.view) ?? null;
  if (!selected && !['watchlist', 'favourites'].includes(input.view))
    throw new AppError(404, 'This list was not found.');
  const config=await getConfig();
  const categoryAllowed=!config.experimentalFeatures ? eq(s.works.category,'screen') : input.category==='all' ? undefined : eq(s.works.category,input.category);
  const available = input.scope === 'available' ? or(hasPermittedMediaSource(viewerId),sql`exists(
    with recursive scope(id,path) as (select ${s.works.id},array[${s.works.id}] union all select r.child_id,d.path||r.child_id from scope d join media_relationships r on r.parent_id=d.id where r.kind in ('contains','collection','sequence') and not r.child_id=any(d.path) and cardinality(d.path)<20)
    select 1 from scope d join availability a on a.media_id=d.id join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id where a.user_id=${viewerId} and c.user_id=${viewerId} and a.state='available' and c.status='connected' and i.enabled
  )`):undefined;
  const pageSize = PAGE_SIZE;
  let total: number;
  let selectedIds: { id: string; entryId?: string }[];
  let page: number;
  let pages: number;
  if (selected) {
    const where = and(
      available,
      categoryAllowed,
      eq(s.listItems.listId, selected.id),
      input.kind === 'all'
        ? undefined
        : input.kind === 'show'
          ? inArray(s.works.kind, ['show', 'season', 'episode'])
          : eq(s.works.kind, input.kind)
    );
    const [count] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(s.listItems)
      .innerJoin(s.works,eq(s.works.id,s.listItems.mediaId))
      .leftJoin(s.media,eq(s.media.id,s.works.id))
      .where(where);
    total = count.total;
    ({ page, pages } = pagination(total, input.page));
    selectedIds = await db
      .select({ id: s.listItems.mediaId, entryId: s.listItems.id })
      .from(s.listItems)
      .innerJoin(s.works,eq(s.works.id,s.listItems.mediaId))
      .leftJoin(s.media,eq(s.media.id,s.works.id))
      .where(where)
      .orderBy(asc(s.listItems.position), asc(s.listItems.mediaId))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  } else {
    // Show progress also includes a partly watched regular episode. Collection
    // progress follows its leaves, just as it does in the shared card read model.
    const progress = sql`(${s.trackingState.positionSeconds} > 0 or ${s.trackingState.completedEpisodes} > 0 or exists (
      select 1 from episodes e join tracking_state child on child.media_id = e.media_id and child.user_id = ${userId}
      where e.show_id = ${s.media.id} and not e.is_special and child.position_seconds > 0
    ) or (${s.media.kind} = 'collection' and exists (
      with recursive descendants(id, path) as (
        select child_id, array[parent_id, child_id] from media_relationships
        where parent_id = ${s.media.id} and kind in ('collection', 'franchise')
        union all
        select r.child_id, d.path || r.child_id from descendants d join media_relationships r on r.parent_id = d.id
        where r.kind in ('collection', 'franchise') and not r.child_id = any(d.path)
      )
      select 1 from descendants d
      join media child_media on child_media.id = d.id
      left join episodes e on e.show_id = d.id or e.season_id = d.id or e.media_id = d.id
      join tracking_state child on child.media_id = coalesce(e.media_id, d.id) and child.user_id = ${userId}
      where (child_media.kind = 'movie' or e.media_id is not null) and not coalesce(e.is_special, false)
        and (child.position_seconds > 0 or (child.watched and coalesce(child.duration_seconds, e.runtime_minutes * 60, child_media.runtime_minutes * 60, 0) > 0))
    )))`;
    const gameStatus=sql`(select gp.status from game_playthroughs gp where gp.user_id=${userId} and gp.game_id=${s.works.id} order by gp.created_at desc,gp.id desc limit 1)`;
    const completed=sql`coalesce(${s.trackingState.watched},false) or exists(select 1 from music_listens ml where ml.user_id=${userId} and ml.track_id=${s.works.id}) or coalesce(${gameStatus}='completed',false)`;
    const dropped=sql`coalesce(${s.trackingState.dropped},false) or coalesce(${gameStatus}='dropped',false)`;
    const started=sql`(${progress}) or exists(select 1 from music_progress mp where mp.user_id=${userId} and mp.track_id=${s.works.id} and mp.position_seconds>0) or coalesce(${gameStatus} in ('in-progress','paused'),false)`;
    const watchlistFilter =
      input.filter === 'complete'
        ? sql`(${completed})`
        : input.filter === 'dropped'
          ? sql`(${dropped})`
          : input.filter === 'all'
            ? undefined
            : and(
                sql`not (${completed})`,
                sql`not (${dropped})`,
                input.filter === 'progress'
                  ? started
                  : sql`not ((${s.works.kind} in ('show','game','track')) and (${started}))`
              );
    const where = and(
      available,
      categoryAllowed,
      eq(s.trackingState.userId, userId),
      input.kind === 'all'
        ? inArray(s.works.kind, ['movie', 'show', 'collection', 'album', 'track', 'game'])
        : eq(s.works.kind, input.kind),
      input.view === 'favourites'
        ? eq(s.trackingState.favourite, true)
        : and(eq(s.trackingState.watchlist, true), watchlistFilter)
    );
    const [count] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(s.trackingState)
      .innerJoin(s.works,eq(s.works.id,s.trackingState.mediaId))
      .leftJoin(s.media,eq(s.media.id,s.works.id))
      .where(where);
    total = count.total;
    ({ page, pages } = pagination(total, input.page));
    selectedIds = await db
      .select({ id: s.works.id })
      .from(s.trackingState)
      .innerJoin(s.works,eq(s.works.id,s.trackingState.mediaId))
      .leftJoin(s.media,eq(s.media.id,s.works.id))
      .where(where)
      .orderBy(
        ...(input.view === 'favourites'
          ? [
              sql`${viewingRecency(userId)} desc nulls last`,
              sql`(select max(e.occurred_at) from tracking_events e
            where e.user_id = ${userId} and e.media_id = ${s.media.id}
              and e.action = 'favourite' and e.value and e.applied and e.occurred_at_known) desc nulls last`,
            ]
          : [desc(s.media.updatedAt)]),
        asc(s.works.id)
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  }
  const views = new Map(
    (
      await workCards(userId,viewerId,selectedIds.map(row=>row.id))
    ).map((item) => [('workId' in item?item.workId:undefined)??item.id, item])
  );
  const sequence = selected?.playlist
    ? await sequenceEntries(userId, { kind: 'playlist', id: selected.id })
    : [];
  const entriesById = new Map(sequence.map((entry) => [entry.entryId, entry]));
  const items = selectedIds.flatMap<MediaView|MediaCardPresentation>((row) => {
    const view = views.get(row.id);
    if (!view) return [];
    const item = {
      ...view,
      entryId: row.entryId,
      ...(selected && row.entryId
        ? { listContext: { listId: selected.id, entryId: row.entryId } }
        : {}),
    };
    if (!selected?.playlist || !row.entryId || 'href' in item) return [item];
    const source = { kind: 'playlist' as const, id: selected.id };
    const entry = entriesById.get(row.entryId);
    return [
      entry
        ? applySequenceEntry(item, entry, source)
        : { ...item, sequence: { ...source, entryId: row.entryId } },
    ];
  });
  return {
    lists,
    selected,
    items,
    total,
    page,
    pages,
    pageSize,
    view: input.view,
    filter: input.filter,
    kind: input.kind,
    scope: input.scope,
  };
}

export async function userLists(userId: string) {
  const rows = await getDb()
    .select()
    .from(s.lists)
    .where(eq(s.lists.userId, userId))
    .orderBy(desc(s.lists.updatedAt));
  const items = rows.length
    ? await getDb()
        .select()
        .from(s.listItems)
        .where(
          inArray(
            s.listItems.listId,
            rows.map((row) => row.id)
          )
        )
        .orderBy(asc(s.listItems.position))
    : [];
  const cards=[];
  const ids=[...new Set(items.map(item=>item.mediaId))];
  for(let offset=0;offset<ids.length;offset+=PAGE_SIZE)cards.push(...await workCards(userId,userId,ids.slice(offset,offset+PAGE_SIZE)));
  const views = new Map(cards.map(item=>[('workId' in item?item.workId:undefined)??item.id,item]));
  const itemsByList = new Map<string, typeof items>();
  for (const item of items) {
    const group = itemsByList.get(item.listId) ?? [];
    group.push(item);
    itemsByList.set(item.listId, group);
  }
  return rows.map((row) => ({
    ...row,
    items: (itemsByList.get(row.id) ?? []).flatMap((item) =>
      views.get(item.mediaId) ? [views.get(item.mediaId)!] : []
    ),
  }));
}
