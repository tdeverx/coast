import { historyScope } from '../../core/tracking/history-scope.server';
import { wholeWorkId } from '../../core/tracking/continue.server';
import { rewatchFields } from '../../core/tracking/rewatch.server';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '../db';
import { getConfig } from '../config';
import { seerrAllows, SeerrPermission } from '../../providers/seerr/adapter.server';
import * as s from '../db/schema';
import { mediaViewsForIds, nextPlayable, permittedAvailability } from './media';
import { AppError } from '../security/errors';
import type { MediaActionData, MediaHistory } from '../../media/actions';
import { pageNumberSchema, pagination, PAGE_SIZE } from './pagination';

const uuid = v.pipe(v.string(), v.uuid());
/** Menu data is local and fetched on open; no provider calls block menu navigation. */
export async function mediaActionData(userId: string, mediaId: string): Promise<MediaActionData> {
  v.parse(uuid, mediaId);
  const db = getDb();
  const [item] = await mediaViewsForIds(userId, [mediaId]);
  if (!item) throw new AppError(404, 'This title was not found.');
  const wholeId = await wholeWorkId(db, mediaId);
  const [wholeWork] = wholeId === mediaId ? [item] : await mediaViewsForIds(userId, [wholeId]);
  const [dated] = await db
    .select({ releaseDate: s.media.releaseDate })
    .from(s.media)
    .where(eq(s.media.id, mediaId));
  const hasReleaseDate = ['show', 'season', 'collection'].includes(item.kind)
    ? (
        await db.execute(sql`with recursive scope(id) as (
        select ${mediaId}::uuid union select edge.id from scope parent join lateral (
          select media_id id from episodes where (show_id=parent.id and not is_special) or season_id=parent.id
          union select child_id from media_relationships where parent_id=parent.id and kind in ('collection','franchise')
        ) edge on true
      ) select 1 from media where id in (select id from scope) and kind in ('movie','episode') and release_date <= (now() at time zone 'UTC')::date limit 1`)
      ).length > 0
    : !!dated?.releaseDate && dated.releaseDate <= new Date().toISOString().slice(0, 10);
  const children =
    item.kind === 'show'
      ? await db
          .select({ id: s.seasons.mediaId })
          .from(s.seasons)
          .where(eq(s.seasons.showId, mediaId))
          .orderBy(asc(s.seasons.seasonNumber))
      : item.kind === 'season'
        ? await db
            .select({ id: s.episodes.mediaId })
            .from(s.episodes)
            .where(eq(s.episodes.seasonId, mediaId))
            .orderBy(asc(s.episodes.episodeNumber))
        : item.kind === 'collection'
          ? await db
              .select({ id: s.mediaRelationships.childId })
              .from(s.mediaRelationships)
              .where(
                and(
                  eq(s.mediaRelationships.parentId, mediaId),
                  inArray(s.mediaRelationships.kind, ['collection', 'franchise'])
                )
              )
              .orderBy(asc(s.mediaRelationships.position))
          : [];
  const views = await mediaViewsForIds(userId, [
    ...(item.trackingParents ?? []).map((row) => row.id),
    ...children.map((row) => row.id),
    ...(item.showId ? [item.showId] : []),
  ]);
  const byId = new Map(views.map((view) => [view.id, view]));
  const requestTarget = ['season', 'episode'].includes(item.kind)
    ? (byId.get(item.showId!) ?? null)
    : ['show', 'movie'].includes(item.kind)
      ? item
      : null;
  const refreshTarget =
    [item, requestTarget].find(
      (target) => target?.tmdbId && ['show', 'movie', 'collection'].includes(target.kind)
    ) ?? null;
  const playable = item.available ? await nextPlayable(userId, item) : null;
  const [config, seerr] = await Promise.all([
    getConfig(),
    db
      .select({ id: s.providerInstances.id })
      .from(s.providerInstances)
      .where(
        and(
          eq(s.providerInstances.provider, 'seerr'),
          eq(s.providerInstances.enabled, true),
          isNotNull(s.providerInstances.credentials),
          isNotNull(s.providerInstances.linkedMediaInstanceId)
        )
      )
      .limit(1),
  ]);
  const [sources, lists, members, requests] = await Promise.all([
    playable
      ? db
          .select({ edition: s.availability.edition })
          .from(s.availability)
          .innerJoin(
            s.providerConnections,
            eq(s.providerConnections.id, s.availability.connectionId)
          )
          .innerJoin(
            s.providerInstances,
            eq(s.providerInstances.id, s.providerConnections.instanceId)
          )
          .where(and(permittedAvailability(userId), eq(s.availability.mediaId, playable.id)))
      : [],
    db
      .select({ id: s.lists.id, name: s.lists.name, playlist: s.lists.playlist })
      .from(s.lists)
      .where(eq(s.lists.userId, userId))
      .orderBy(asc(s.lists.name)),
    db
      .select({ id: s.listItems.id, listId: s.listItems.listId, position: s.listItems.position })
      .from(s.listItems)
      .innerJoin(s.lists, eq(s.lists.id, s.listItems.listId))
      .where(and(eq(s.lists.userId, userId), eq(s.listItems.mediaId, mediaId)))
      .orderBy(asc(s.listItems.position)),
    requestTarget
      ? db
          .select({
            id: s.mediaRequests.id,
            state: s.mediaRequests.state,
            seasons: s.mediaRequests.seasons,
            destination: s.providerInstances.name,
            is4k: s.mediaRequests.is4k,
            externalId: s.mediaRequests.externalId,
            enabled: s.providerInstances.enabled,
            connectionStatus: s.providerConnections.status,
            settings: s.providerConnections.settings,
          })
          .from(s.mediaRequests)
          .innerJoin(s.providerInstances, eq(s.providerInstances.id, s.mediaRequests.instanceId))
          .leftJoin(
            s.providerConnections,
            and(
              eq(s.providerConnections.instanceId, s.mediaRequests.instanceId),
              eq(s.providerConnections.userId, userId)
            )
          )
          .where(
            and(eq(s.mediaRequests.userId, userId), eq(s.mediaRequests.mediaId, requestTarget.id))
          )
          .orderBy(desc(s.mediaRequests.createdAt))
      : [],
  ]);
  const rewatches = await db
    .select({ mediaId: s.rewatches.mediaId, startedAt: s.rewatches.startedAt })
    .from(s.rewatches)
    .where(
      and(
        eq(s.rewatches.userId, userId),
        inArray(s.rewatches.mediaId, [mediaId, ...views.map((view) => view.id)])
      )
    );
  const resetCandidates = [mediaId, ...views.map((view) => view.id)];
  const progressTargets = await db.execute<{ id: string }>(sql`
    with recursive scope(root, id) as (
      select id, id from media where ${inArray(sql`id`, resetCandidates)}
      union
      select parent.root, edge.id from scope parent join lateral (
        select e.media_id id from episodes e where (e.show_id = parent.id and not e.is_special) or e.season_id = parent.id
        union select r.child_id from media_relationships r where r.parent_id = parent.id and r.kind in ('collection', 'franchise')
      ) edge on true
    )
    select distinct scope.root as id from scope join tracking_state on tracking_state.media_id = scope.id
    where tracking_state.user_id = ${userId} and (${rewatchFields(userId, sql`scope.id`).progress}) > 0
  `);
  const [personal] = await db
    .select()
    .from(s.userMetadataPreferences)
    .where(
      and(
        eq(s.userMetadataPreferences.userId, userId),
        eq(s.userMetadataPreferences.mediaId, mediaId)
      )
    );
  const rewatch = rewatches.find((row) => row.mediaId === mediaId);
  return {
    item,
    wholeWork: wholeWork ?? item,
    releaseDate: dated?.releaseDate ?? null,
    hasReleaseDate,
    progressTargetIds: progressTargets.map((row) => row.id),
    hasPersonalOverrides: !!(personal?.title || personal?.posterPath || personal?.backdropPath),
    ownRewatchStartedAt: rewatch?.startedAt.toISOString() ?? null,
    rewatchTargetIds: rewatches.map((row) => row.mediaId),
    targets: [
      item,
      ...(item.trackingParents ?? []).flatMap((parent) =>
        byId.has(parent.id) ? [byId.get(parent.id)!] : []
      ),
    ],
    children: children.flatMap((child) => (byId.has(child.id) ? [byId.get(child.id)!] : [])),
    requestTarget,
    requestsEnabled: config.enableRequests && seerr.length > 0,
    refreshTarget,
    playable,
    editions: [...new Set(sources.map((source) => source.edition ?? ''))],
    lists: lists.map((list) => ({
      ...list,
      entries: members
        .filter((member) => member.listId === list.id)
        .map(({ id, position }) => ({ id, position })),
    })),
    requests: requests
      .filter((request) => !['cancelled', 'declined'].includes(request.state))
      .map(({ externalId, enabled, connectionStatus, settings, ...request }) => {
        const connected = config.enableRequests && enabled && connectionStatus === 'connected';
        const manager =
          connected &&
          seerrAllows(Number(settings?.seerrPermissions) || 0, SeerrPermission.MANAGE_REQUESTS);
        return {
          ...request,
          canCancel: !externalId
            ? ['pending', 'failed'].includes(request.state)
            : connected &&
              (manager || request.state === 'pending') &&
              ['pending', 'approved', 'failed'].includes(request.state),
          canApprove: !!externalId && manager && request.state === 'pending',
          canDecline: !!externalId && manager && request.state === 'pending',
        };
      }),
  };
}
/** Group history includes its descendants, with cycles and repeated membership deduplicated. */
export async function mediaHistory(
  userId: string,
  mediaId: string,
  requestedPage = 1
): Promise<MediaHistory> {
  v.parse(uuid, mediaId);
  v.parse(pageNumberSchema, requestedPage);
  const db = getDb();
  const scope = historyScope(mediaId);
  const where = and(
    eq(s.trackingEvents.userId, userId),
    sql`${s.trackingEvents.mediaId} in (${scope})`,
    inArray(s.trackingEvents.action, ['watch', 'unwatch', 'progress'])
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(s.trackingEvents)
    .where(where);
  const { page, pages } = pagination(count.total, requestedPage);
  const rows = await db
    .select({
      id: s.trackingEvents.id,
      mediaId: s.media.id,
      title: s.media.title,
      action: s.trackingEvents.action,
      source: s.trackingEvents.source,
      occurredAt: s.trackingEvents.occurredAt,
      occurredAtKnown: s.trackingEvents.occurredAtKnown,
      rewatch: s.trackingEvents.rewatch,
      positionSeconds: s.trackingEvents.positionSeconds,
      applied: s.trackingEvents.applied,
    })
    .from(s.trackingEvents)
    .innerJoin(s.media, eq(s.media.id, s.trackingEvents.mediaId))
    .where(where)
    .orderBy(desc(s.trackingEvents.occurredAt), desc(s.trackingEvents.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return {
    items: rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
    page,
    pages,
    total: count.total,
  };
}

/** Hydrated audit activity uses the same journal layout as profile activity. */
export async function mediaActivity(userId: string, mediaId: string, page = 1) {
  const history = await mediaHistory(userId, mediaId, page);
  const views = await mediaViewsForIds(userId, [
    ...new Set(history.items.map((row) => row.mediaId)),
  ]);
  const shows = await mediaViewsForIds(userId, [
    ...new Set(views.flatMap((item) => (item.showId ? [item.showId] : []))),
  ]);
  const byId = new Map(views.map((item) => [item.id, item]));
  const showById = new Map(shows.map((item) => [item.id, item]));
  return {
    ...history,
    items: history.items.flatMap((event) => {
      const item = byId.get(event.mediaId);
      if (!item || !['watch', 'unwatch', 'progress'].includes(event.action)) return [];
      return [
        {
          ...item,
          ...(item.kind === 'episode'
            ? {
                captionTitle: showById.get(item.showId!)?.title ?? item.title,
                captionSubtitle: `S${String(item.seasonNumber ?? 0).padStart(2, '0')}E${String(item.episodeNumber ?? 0).padStart(2, '0')} · ${item.title}`,
              }
            : {}),
          eventId: event.id,
          watchedAt: event.occurredAt,
          dateKnown: event.occurredAtKnown,
          source: event.source,
          rewatched: event.rewatch,
          action: v.parse(v.picklist(['watch', 'unwatch', 'progress']), event.action),
          applied: event.applied,
          positionSeconds: event.positionSeconds,
        },
      ];
    }),
  };
}
