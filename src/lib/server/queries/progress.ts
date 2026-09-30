import { rewatchBoundary, rewatchFields } from '../../core/tracking/rewatch';
import type { MediaView } from '$lib/ui/types';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../db';
import * as s from '../db/schema';
import { progressOptionsSchema, type ProgressContent } from '../../progress';
import { continuationIds } from './continuations';
import { profileProgress } from './profile';
import { listsData } from './lists';
import { applySequenceEntry, hasPermittedMediaSource, mediaViewsForIds } from './media';
import { viewingRecency } from './viewing-recency';
import { pagination, PAGE_SIZE } from './pagination';

/** Plan using lightweight IDs; hydrate only the filtered, visible page. */
export async function progressData(
  userId: string,
  raw: unknown = {},
  viewerId = userId
): Promise<ProgressContent> {
  const options = v.parse(progressOptionsSchema, raw);
  if (options.view === 'watchlist' || options.view === 'favourites') {
    const list = await listsData(userId, { ...options, filter: 'to-watch',category:'screen' }, viewerId);
    return { ...options, page: list.page, pages: list.pages, total: list.total, items: list.items.filter((item):item is MediaView=>!('href' in item)) };
  }
  if (options.view === 'finished' || options.view === 'dropped') {
    const result = await profileProgress(
      userId,
      options.view === 'finished' ? 'watched' : 'dropped',
      options.page,
      options,
      viewerId
    );
    return {
      ...options,
      items: result.items,
      total: result.total,
      page: result.page,
      pages: result.pages,
    };
  }
  const db = getDb();
  const states = await db
    .select({
      id: s.trackingState.mediaId,
      ownRewatch: sql<boolean>`exists(select 1 from rewatches r where r.user_id=${userId} and r.media_id=${s.media.id})`,
      ...rewatchFields(userId, sql`${s.media.id}`),
      duration: s.trackingState.durationSeconds,
      dropped: s.trackingState.dropped,
      kind: s.media.kind,
    })
    .from(s.trackingState)
    .innerJoin(s.media, eq(s.media.id, s.trackingState.mediaId))
    .where(eq(s.trackingState.userId, userId))
    .orderBy(desc(s.trackingState.updatedAt), s.media.id);
  const planned = await continuationIds(
    userId,
    states.filter((row) => !row.dropped && (row.watched || row.progress > 0)).map((row) => row.id),
    false
  );
  const sequenceById = new Map(planned.sequenceNext.map((next) => [next.entry.mediaId, next]));
  const activeIds = states
    .filter(
      (row) =>
        !row.dropped &&
        ((row.progress > 0 && (!row.duration || row.progress < row.duration * 0.9)) ||
          (row.ownRewatch && !row.watched)) &&
        ['movie', 'episode'].includes(row.kind)
    )
    .map((row) => row.id);
  for (const next of planned.sequenceNext) {
    if (next.entry.progress > 0 && !next.entry.watched && !activeIds.includes(next.entry.mediaId))
      activeIds.push(next.entry.mediaId);
  }
  const queued =
    options.view === 'up-next'
      ? await db
          .select({ id: s.upNext.mediaId })
          .from(s.upNext)
          .where(eq(s.upNext.userId, userId))
          .orderBy(desc(s.upNext.addedAt), s.upNext.mediaId)
      : [];
  const candidateIds = [
    ...new Set(
      options.view === 'watching'
        ? [...activeIds, ...planned.nextIds]
        : [
            ...queued.map((row) => row.id),
            ...planned.newSeasonIds,
            ...planned.nextIds,
            ...sequenceById.keys(),
          ]
    ),
  ];
  if (!candidateIds.length) return { ...options, items: [], total: 0, page: 1, pages: 1 };
  const active = new Set(activeIds),
    manual = new Set(queued.map((row) => row.id));
  const candidates = await db
    .select({ id: s.media.id, kind: s.media.kind })
    .from(s.media)
    .where(
      and(
        inArray(s.media.id, candidateIds),
        options.kind === 'movie'
          ? eq(s.media.kind, 'movie')
          : options.kind === 'show'
            ? inArray(s.media.kind, ['show', 'season', 'episode'])
            : undefined,
        options.scope === 'available' ? hasPermittedMediaSource(viewerId) : undefined,
        sql`not exists (select 1 from episodes e join tracking_state parent on parent.media_id in (e.show_id,e.season_id)
      where e.media_id = ${s.media.id} and parent.user_id = ${userId} and parent.dropped)`
      )
    )
    .orderBy(
      ...(options.view === 'watching'
        ? [
            sql`greatest(${rewatchBoundary(userId, sql`${s.media.id}`)}, ${viewingRecency(userId, sql`coalesce((select e.show_id from episodes e where e.media_id = ${s.media.id}), ${s.media.id})`)}) desc nulls last`,
          ]
        : []),
      s.media.id
    );
  const eligible = new Set(
    candidates
      .filter((row) =>
        options.view === 'watching'
          ? active.has(row.id) || row.kind === 'episode'
          : !active.has(row.id) &&
            (manual.has(row.id) ||
              sequenceById.has(row.id) ||
              row.kind === 'season' ||
              row.kind === 'movie')
      )
      .map((row) => row.id)
  );
  const ids = (options.view === 'watching' ? candidates.map((row) => row.id) : candidateIds).filter(
    (id) => eligible.has(id)
  );
  const { page, pages } = pagination(ids.length, options.page);
  const visibleIds = ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const views = new Map(
    (await mediaViewsForIds(userId, visibleIds, viewerId)).map((item) => [item.id, item])
  );
  const items = visibleIds.flatMap((id) => (views.has(id) ? [views.get(id)!] : []));
  const showIds = [...new Set(items.flatMap((item) => (item.showId ? [item.showId] : [])))];
  const titles = new Map(
    (await mediaViewsForIds(userId, showIds, viewerId)).map((item) => [item.id, item.title])
  );
  for (let index = 0; index < items.length; index++) {
    let item = items[index];
    const context = sequenceById.get(item.id);
    if (context && (options.view !== 'watching' || context.entry.progress > 0)) {
      item = items[index] = applySequenceEntry(item, context.entry, context.source);
      item.captionSubtitle = context.title + (item.rewatchStartedAt ? ' · Rewatching' : '');
      continue;
    }
    const title = item.showId ? titles.get(item.showId) : undefined;
    if (!title) {
      if (item.rewatchStartedAt) item.captionSubtitle = 'Rewatching';
      continue;
    }
    item.captionTitle = title;
    item.captionSubtitle =
      item.kind === 'episode'
        ? `S${String(item.seasonNumber ?? 0).padStart(2, '0')}E${String(item.episodeNumber ?? 0).padStart(2, '0')} ${item.title}`
        : item.title?.trim() || `Season ${item.seasonNumber ?? 0}`;
    if (item.rewatchStartedAt) item.captionSubtitle += ' · Rewatching';
  }
  return { ...options, page, pages, total: ids.length, items };
}
