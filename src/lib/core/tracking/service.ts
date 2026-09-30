import { sequenceContextSchema } from '../../media/sequence';
import { sequenceEntries } from '../lists/sequence';
import { rewatchBoundary } from './rewatch';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb, type Database } from '../../server/db';
import {
  editionProgress,
  listItems,
  episodes,
  media,
  works,
  mediaRelationships,
  trackingEvents,
  removedTrackingSources,
  trackingState,
  upNext,
} from '../../server/db/schema';
import { AcknowledgementRequired, DomainError } from '../errors';
import {
  emptyTrackingState,
  episodeOrderWarning,
  projectTracking,
  type TrackingProjection,
} from './state';

const uuidSchema = v.pipe(v.string(), v.uuid());
const seconds = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(60 * 60 * 24 * 30));
export const trackingInputSchema = v.object({
  sequence: v.optional(sequenceContextSchema),
  mediaId: uuidSchema,
  action: v.picklist([
    'watch',
    'unwatch',
    'progress',
    'drop',
    'restore',
    'watchlist',
    'favourite',
    'collect',
  ]),
  value: v.optional(v.boolean()),
  positionSeconds: v.optional(seconds),
  durationSeconds: v.optional(seconds),
  editionId: v.optional(v.pipe(v.string(), v.maxLength(300))),
  rewatch: v.optional(v.boolean()),
  acknowledged: v.optional(v.boolean()),
  source: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(50)), 'coast'),
  sourceEventId: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(300))),
  occurredAtKnown: v.optional(v.boolean()),
  occurredAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
});
export type TrackingInput = v.InferInput<typeof trackingInputSchema>;
type ParsedInput = v.InferOutput<typeof trackingInputSchema>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TrackingResult {
  state: TrackingProjection;
  eventId: string | null;
  changed: boolean;
  progressChanged: boolean;
  duplicate: boolean;
  reviewRequired: boolean;
  warning?: string;
  removedQueueIds?: string[];
}
function trackingKey(userId: string, mediaId: string) {
  return and(eq(trackingState.userId, userId), eq(trackingState.mediaId, mediaId));
}
async function ensureProjection(tx: Transaction, userId: string, mediaId: string) {
  await tx.insert(trackingState).values({ userId, mediaId }).onConflictDoNothing();
  const [state] = await tx.select().from(trackingState).where(trackingKey(userId, mediaId));
  return state!;
}
async function warningFor(
  tx: Transaction,
  userId: string,
  input: ParsedInput,
  state: TrackingProjection
): Promise<string | null> {
  if (input.action === 'unwatch' && (state.positionSeconds >= 1200 || state.playCount >= 3))
    return 'This will clear substantial viewing progress. Your viewing history will be preserved. Continue?';
  if (
    input.action === 'progress' &&
    state.positionSeconds >= 1200 &&
    (input.positionSeconds ?? state.positionSeconds) < state.positionSeconds / 4 &&
    input.source !== 'playback'
  )
    return 'This change clears most of the saved progress. Continue?';
  if (input.action !== 'watch' && input.action !== 'unwatch') return null;
  const [episode] = await tx.select().from(episodes).where(eq(episodes.mediaId, input.mediaId));
  if (!episode) return null;
  const siblings = await tx
    .select({
      mediaId: episodes.mediaId,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      isSpecial: episodes.isSpecial,
      watched: trackingState.watched,
    })
    .from(episodes)
    .leftJoin(
      trackingState,
      and(eq(trackingState.mediaId, episodes.mediaId), eq(trackingState.userId, userId))
    )
    .where(eq(episodes.showId, episode.showId));
  return episodeOrderWarning(
    siblings.map((e) => ({ ...e, watched: e.watched ?? false })),
    input.mediaId,
    input.action
  );
}

async function applyChange(
  tx: Transaction,
  userId: string,
  input: ParsedInput,
  skipOrderWarning = false
): Promise<TrackingResult> {
  const [item] = await tx
    .select({ kind: works.kind, category: works.category })
    .from(works)
    .where(eq(works.id, input.mediaId));
  if (!item) throw new DomainError('This title was not found.', 404, 'not_found');
  if (item.category !== 'screen' && ['watch', 'unwatch', 'progress', 'drop', 'restore'].includes(input.action))
    throw new DomainError('Use this medium’s activity controls.');
  if (
    (item.kind === 'show' || item.kind === 'season' || item.kind === 'collection') &&
    ['watch', 'unwatch', 'progress'].includes(input.action)
  )
    throw new DomainError('Use the bulk tracking action for a show, season or collection.');
  const state = await ensureProjection(tx, userId, input.mediaId);
  if (input.sourceEventId) {
    const [removed] = await tx
      .select()
      .from(removedTrackingSources)
      .where(
        and(
          eq(removedTrackingSources.userId, userId),
          eq(removedTrackingSources.source, input.source),
          eq(removedTrackingSources.sourceEventId, input.sourceEventId)
        )
      );
    if (removed)
      return {
        state,
        eventId: null,
        changed: false,
        progressChanged: false,
        duplicate: true,
        reviewRequired: false,
      };
    const [existing] = await tx
      .select()
      .from(trackingEvents)
      .where(
        and(
          eq(trackingEvents.userId, userId),
          eq(trackingEvents.source, input.source),
          eq(trackingEvents.sourceEventId, input.sourceEventId)
        )
      );
    if (existing)
      return {
        state,
        eventId: existing.id,
        changed: false,
        progressChanged: false,
        duplicate: true,
        reviewRequired: !existing.applied && existing.reviewedAt === null,
        warning: existing.reviewedAt ? undefined : (existing.reviewReason ?? undefined),
      };
  }
  if (input.sequence && input.source === 'coast') {
    const entry = (await sequenceEntries(userId, input.sequence)).find(
      (entry) => entry.entryId === input.sequence!.entryId && entry.mediaId === input.mediaId
    );
    if (!entry) throw new DomainError('This sequence entry no longer exists.');
    if (input.action === 'watch' && state.watched && !entry.watched) input.rewatch = true;
  }
  // A manual completion in a rewatch is a new play, even though lifetime completion remains true.
  if (input.action === 'watch' && input.source === 'coast' && state.watched && !input.rewatch) {
    const [row] = await tx
      .select({ startedAt: rewatchBoundary(userId, sql`${input.mediaId}::uuid`) })
      .from(media)
      .where(eq(media.id, input.mediaId));
    if (row?.startedAt && (!state.lastWatchedAt || state.lastWatchedAt < new Date(row.startedAt)))
      input.rewatch = true;
  }
  const imported = input.source !== 'coast' && input.source !== 'playback';
  const occurredAtKnown = input.occurredAtKnown ?? (!imported || !!input.occurredAt);
  const projected = projectTracking(state, {
    ...input,
    occurredAt: occurredAtKnown
      ? input.occurredAt
        ? new Date(input.occurredAt)
        : new Date()
      : null,
  });
  const contradictory =
    imported &&
    projected.changed &&
    state.watched &&
    (input.action === 'unwatch' || (input.action === 'progress' && input.positionSeconds === 0))
      ? 'This imported change contradicts completed Coast history. Review it before applying.'
      : null;
  const warning = projected.changed
    ? (contradictory ?? (skipOrderWarning ? null : await warningFor(tx, userId, input, state)))
    : null;
  const reviewRequired = Boolean(warning && !input.acknowledged && imported);
  if (warning && !input.acknowledged && !imported) throw new AcknowledgementRequired(warning);
  // An explicit position edit applies across editions; stale source-specific seeks must not win.
  if (
    input.source === 'coast' &&
    input.action === 'progress' &&
    !input.editionId &&
    !reviewRequired
  )
    await tx
      .delete(editionProgress)
      .where(and(eq(editionProgress.userId, userId), eq(editionProgress.mediaId, input.mediaId)));
  // Preserve a source identity for no-op imports so reconnect/retry never counts it as new.
  if (!projected.changed && !input.sourceEventId && !input.sequence)
    return {
      state,
      eventId: null,
      changed: false,
      progressChanged: false,
      duplicate: false,
      reviewRequired: false,
    };
  const [event] = await tx
    .insert(trackingEvents)
    .values({
      userId,
      mediaId: input.mediaId,
      action: input.action,
      source: input.source,
      sourceEventId: input.sourceEventId,
      sequence: input.sequence,
      value: input.value,
      positionSeconds: input.positionSeconds,
      durationSeconds: input.durationSeconds,
      editionId: input.editionId,
      rewatch: input.rewatch ?? false,
      occurredAtKnown,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      applied: !reviewRequired,
      reviewReason: reviewRequired ? warning : null,
    })
    .returning({ id: trackingEvents.id });
  if (reviewRequired)
    return {
      state,
      eventId: event.id,
      changed: false,
      progressChanged: false,
      duplicate: false,
      reviewRequired: true,
      warning: warning ?? undefined,
    };
  await tx
    .update(trackingState)
    .set({ ...projected.state, updatedAt: new Date() })
    .where(trackingKey(userId, input.mediaId));
  let removedQueueIds: string[] = [];
  // Starting a queued title also consumes queued season/show/collection parents.
  if (
    (projected.progressChanged && projected.state.positionSeconds > 0) ||
    (projected.changed && ['watch', 'drop'].includes(input.action))
  ) {
    const removed = await tx
      .delete(upNext)
      .where(
        and(
          eq(upNext.userId, userId),
          sql`${upNext.mediaId} in (
      with recursive parents(id) as (
        select ${input.mediaId}::uuid
        union select r.parent_id from media_relationships r join parents p on r.child_id = p.id
      )
      select id from parents
      union select show_id from episodes where media_id = ${input.mediaId}
      union select season_id from episodes where media_id = ${input.mediaId}
    )`
        )
      )
      .returning({ mediaId: upNext.mediaId });
    removedQueueIds = removed.map((row) => row.mediaId);
  }
  if (input.editionId && (input.action === 'progress' || input.action === 'watch')) {
    const progress = {
      positionSeconds: projected.state.positionSeconds,
      durationSeconds: projected.state.durationSeconds,
      updatedAt: new Date(),
    };
    await tx
      .insert(editionProgress)
      .values({ userId, mediaId: input.mediaId, editionId: input.editionId, ...progress })
      .onConflictDoUpdate({
        target: [editionProgress.userId, editionProgress.mediaId, editionProgress.editionId],
        set: progress,
      });
  }
  return {
    state: projected.state,
    removedQueueIds,
    eventId: event.id,
    changed: projected.changed,
    progressChanged: projected.progressChanged,
    duplicate: false,
    reviewRequired: false,
  };
}

async function refreshAncestors(
  tx: Transaction,
  userId: string,
  ids: string[],
  rebuilding = false
) {
  if (!ids.length) return;
  const changed = await tx.select().from(episodes).where(inArray(episodes.mediaId, ids));
  const parents = new Map<string, 'show' | 'season'>();
  for (const episode of changed) {
    parents.set(episode.showId, 'show');
    if (episode.seasonId) parents.set(episode.seasonId, 'season');
  }
  for (const [parentId, kind] of parents) {
    const children = await tx
      .select({
        watched: trackingState.watched,
        playCount: trackingState.playCount,
        lastWatchedAt: trackingState.lastWatchedAt,
      })
      .from(episodes)
      .leftJoin(
        trackingState,
        and(eq(trackingState.mediaId, episodes.mediaId), eq(trackingState.userId, userId))
      )
      .where(
        and(
          eq(kind === 'show' ? episodes.showId : episodes.seasonId, parentId),
          eq(episodes.isSpecial, false)
        )
      );
    const total = children.length;
    const completed = children.filter((child) => child.watched).length;
    const existing = await ensureProjection(tx, userId, parentId);
    const watched = total > 0 && completed === total;
    const lastWatchedAt =
      children
        .map((c) => c.lastWatchedAt)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ??
      (rebuilding ? null : existing.lastWatchedAt);
    await tx
      .update(trackingState)
      .set({
        totalEpisodes: total,
        completedEpisodes: completed,
        watched,
        dropped: rebuilding ? existing.dropped : false,
        playCount: rebuilding
          ? children.length
            ? Math.min(...children.map((child) => child.playCount ?? 0))
            : 0
          : !existing.watched && watched
            ? existing.playCount + 1
            : existing.playCount,
        lastWatchedAt,
        updatedAt: new Date(),
      })
      .where(trackingKey(userId, parentId));
  }
  await refreshCollections(tx, userId, [...ids, ...parents.keys()], rebuilding);
}

async function refreshCollections(
  tx: Transaction,
  userId: string,
  changedIds: string[],
  rebuilding = false
) {
  let frontier = changedIds;
  const ancestors = new Set<string>();
  while (frontier.length) {
    const relationships = await tx
      .select({ id: mediaRelationships.parentId })
      .from(mediaRelationships)
      .where(
        and(
          inArray(mediaRelationships.childId, frontier),
          inArray(mediaRelationships.kind, ['collection', 'franchise'])
        )
      );
    frontier = [];
    for (const { id } of relationships) {
      if (ancestors.has(id)) continue;
      ancestors.add(id);
      frontier.push(id);
    }
  }
  const visited = new Set<string>();
  const update = async (id: string): Promise<void> => {
    if (visited.has(id)) return;
    visited.add(id);
    const relationships = await tx
      .select()
      .from(mediaRelationships)
      .where(
        and(
          eq(mediaRelationships.parentId, id),
          inArray(mediaRelationships.kind, ['collection', 'franchise'])
        )
      );
    for (const relationship of relationships)
      if (ancestors.has(relationship.childId)) await update(relationship.childId);
    const children = relationships.length
      ? await tx
          .select({
            watched: trackingState.watched,
            playCount: trackingState.playCount,
            lastWatchedAt: trackingState.lastWatchedAt,
          })
          .from(trackingState)
          .where(
            and(
              eq(trackingState.userId, userId),
              inArray(
                trackingState.mediaId,
                relationships.map((relationship) => relationship.childId)
              )
            )
          )
      : [];
    const existing = await ensureProjection(tx, userId, id);
    const watched =
      relationships.length > 0 &&
      children.length === new Set(relationships.map((relationship) => relationship.childId)).size &&
      children.every((child) => child.watched);
    const lastWatchedAt =
      children
        .map((child) => child.lastWatchedAt)
        .filter((date): date is Date => date !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ??
      (rebuilding ? null : existing.lastWatchedAt);
    await tx
      .update(trackingState)
      .set({
        watched,
        dropped: rebuilding ? existing.dropped : false,
        playCount: rebuilding
          ? children.length
            ? Math.min(...children.map((child) => child.playCount ?? 0))
            : 0
          : !existing.watched && watched
            ? existing.playCount + 1
            : existing.playCount,
        lastWatchedAt,
        updatedAt: new Date(),
      })
      .where(trackingKey(userId, id));
  };
  for (const id of ancestors) await update(id);
}

/** Services accept source identities only from trusted server callers; public routes must set source=coast. */
export async function track(userId: string, raw: TrackingInput): Promise<TrackingResult> {
  return getDb().transaction((tx) => trackInTransaction(tx, userId, raw));
}

/** Join an existing Coast transaction, e.g. request + saved intent + durable outbox. */
export async function trackInTransaction(
  tx: Transaction,
  userId: string,
  raw: TrackingInput
): Promise<TrackingResult> {
  v.parse(uuidSchema, userId);
  const input = v.parse(trackingInputSchema, raw);
  if (
    input.source === 'coast' &&
    input.occurredAt &&
    new Date(input.occurredAt).getTime() > Date.now()
  )
    throw new DomainError('Choose a watch date in the past or now.');
  if (input.action === 'progress' && input.positionSeconds === undefined)
    throw new DomainError('A progress position is required.');
  if (
    input.positionSeconds !== undefined &&
    input.durationSeconds !== undefined &&
    input.durationSeconds > 0 &&
    input.positionSeconds > input.durationSeconds + 5
  )
    throw new DomainError('Progress cannot be beyond the end of the video.');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
  const result = await applyChange(tx, userId, input);
  if (result.progressChanged && !result.duplicate && !result.reviewRequired)
    await refreshAncestors(tx, userId, [input.mediaId]);
  return result;
}
export const bulkTrackingInputSchema = v.object({
  sequence: v.optional(sequenceContextSchema),
  mediaId: uuidSchema,
  action: v.picklist(['watch', 'unwatch', 'progress']),
  occurredAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
  rewatch: v.optional(v.boolean()),
  includeSpecials: v.optional(v.boolean(), false),
  onReleaseDate: v.optional(v.boolean(), false),
  acknowledged: v.optional(v.boolean(), false),
});
export async function bulkTrack(userId: string, raw: v.InferInput<typeof bulkTrackingInputSchema>) {
  return getDb().transaction((tx) => bulkTrackInTransaction(tx, userId, raw));
}
export async function bulkTrackInTransaction(
  tx: Transaction,
  userId: string,
  raw: v.InferInput<typeof bulkTrackingInputSchema>
) {
  v.parse(uuidSchema, userId);
  const input = v.parse(bulkTrackingInputSchema, raw);
  if (input.occurredAt && new Date(input.occurredAt).getTime() > Date.now())
    throw new DomainError('Choose a watch date in the past or now.');
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
  const [parent] = await tx.select().from(media).where(eq(media.id, input.mediaId));
  if (!parent || !['show', 'season', 'collection'].includes(parent.kind))
    throw new DomainError('Choose a show, season or collection for bulk tracking.');
  let scopedEntries = input.sequence ? await sequenceEntries(userId, input.sequence) : [];
  if (input.sequence) {
    const prefix = input.sequence.entryId;
    if (input.sequence.kind === 'playlist') v.parse(uuidSchema, prefix.split('/')[0]);
    const [root] =
      input.sequence.kind === 'playlist'
        ? await tx
            .select()
            .from(listItems)
            .where(eq(listItems.id, prefix.split('/')[0]))
        : [];
    const matches =
      prefix.endsWith('/' + input.mediaId) ||
      (input.sequence.kind === 'collection' && prefix === input.mediaId) ||
      (root?.mediaId === input.mediaId && prefix === root.id);
    if (!matches) throw new DomainError('This sequence target no longer exists.');
    scopedEntries = scopedEntries.filter((entry) => entry.entryId.startsWith(prefix + '/'));
  }
  let ids = input.sequence
    ? [...new Set(scopedEntries.map((entry) => entry.mediaId))]
    : await bulkTargets(tx, input.mediaId, input.includeSpecials);
  const dates = new Map<string, string>();
  if (input.onReleaseDate) {
    if (input.action !== 'watch') throw new DomainError('Release dates only apply to watches.');
    const rows = ids.length
      ? await tx
          .select({ id: media.id, date: media.releaseDate })
          .from(media)
          .where(inArray(media.id, ids))
      : [];
    const today = new Date().toISOString().slice(0, 10);
    for (const row of rows)
      if (row.date && row.date <= today) dates.set(row.id, `${row.date}T00:00:00.000Z`);
    ids = ids.filter((id) => dates.has(id));
    scopedEntries = scopedEntries.filter((entry) => dates.has(entry.mediaId));
  }
  if (!ids.length)
    throw new DomainError(
      'No titles or episodes are available to track yet. Add titles or refresh the metadata first.'
    );
  const existing = await tx
    .select()
    .from(trackingState)
    .where(and(eq(trackingState.userId, userId), inArray(trackingState.mediaId, ids)));
  if (
    input.action === 'unwatch' &&
    !input.acknowledged &&
    existing.some((state) => state.watched || state.positionSeconds > 0)
  )
    throw new AcknowledgementRequired(
      `Mark ${ids.length} ${parent.kind === 'collection' ? 'titles and episodes' : 'episodes'} unwatched? Your viewing history will be preserved.`
    );
  const collectionEntries =
    parent.kind === 'collection' && input.action === 'watch'
      ? await sequenceEntries(userId, { kind: 'collection', id: parent.id })
      : [];
  const targets = input.sequence
    ? scopedEntries.map((entry) => ({ mediaId: entry.mediaId, entry }))
    : ids.map((mediaId) => ({
        mediaId,
        entry: collectionEntries.find((entry) => entry.mediaId === mediaId && !entry.watched),
      }));
  const results: TrackingResult[] = [];
  for (const { mediaId, entry } of targets) {
    results.push(
      await applyChange(
        tx,
        userId,
        {
          mediaId,
          action: input.action,
          positionSeconds: input.action === 'progress' ? 0 : undefined,
          occurredAt: dates.get(mediaId) ?? input.occurredAt,
          rewatch: input.rewatch,
          source: 'coast',
          acknowledged: true,
          sequence: entry
            ? {
                kind: input.sequence?.kind ?? 'collection',
                id: input.sequence?.id ?? parent.id,
                entryId: entry.entryId,
              }
            : undefined,
        },
        true
      )
    );
  }
  const events = results.flatMap((result, index) =>
    result.changed && result.eventId
      ? [{ mediaId: targets[index].mediaId, eventId: result.eventId, action: input.action }]
      : []
  );
  const changedIds = events.map((event) => event.mediaId);
  if (changedIds.length) await refreshAncestors(tx, userId, changedIds);
  return { changed: changedIds.length, total: targets.length, events };
}

async function bulkTargets(
  tx: Transaction,
  mediaId: string,
  includeSpecials: boolean
): Promise<string[]> {
  const visited = new Set<string>();
  const leaves = new Set<string>();
  const walk = async (id: string): Promise<void> => {
    if (visited.has(id)) return;
    visited.add(id);
    const [item] = await tx.select({ kind: media.kind }).from(media).where(eq(media.id, id));
    if (!item) return;
    if (item.kind === 'movie') {
      leaves.add(id);
      return;
    }
    if (item.kind === 'episode') {
      const [episode] = await tx.select().from(episodes).where(eq(episodes.mediaId, id));
      if (includeSpecials || !episode?.isSpecial) leaves.add(id);
      return;
    }
    if (item.kind === 'show' || item.kind === 'season') {
      const children = await tx
        .select({ id: episodes.mediaId })
        .from(episodes)
        .where(
          and(
            eq(item.kind === 'show' ? episodes.showId : episodes.seasonId, id),
            includeSpecials || (item.kind === 'season' && id === mediaId)
              ? undefined
              : eq(episodes.isSpecial, false)
          )
        )
        .orderBy(asc(episodes.seasonNumber), asc(episodes.episodeNumber));
      children.forEach((child) => leaves.add(child.id));
      return;
    }
    const children = await tx
      .select({ id: mediaRelationships.childId })
      .from(mediaRelationships)
      .where(
        and(
          eq(mediaRelationships.parentId, id),
          inArray(mediaRelationships.kind, ['collection', 'franchise'])
        )
      )
      .orderBy(asc(mediaRelationships.position));
    for (const child of children) await walk(child.id);
  };
  await walk(mediaId);
  return [...leaves];
}
export async function getTracking(userId: string, mediaId: string) {
  v.parse(uuidSchema, userId);
  v.parse(uuidSchema, mediaId);
  const [state] = await getDb().select().from(trackingState).where(trackingKey(userId, mediaId));
  return state ?? { ...emptyTrackingState(), userId, mediaId };
}
export async function getHistory(
  userId: string,
  options: { mediaId?: string; before?: string; limit?: number; reviewOnly?: boolean } = {}
) {
  v.parse(uuidSchema, userId);
  if (options.mediaId) v.parse(uuidSchema, options.mediaId);
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  if (options.before && !Number.isFinite(new Date(options.before).getTime()))
    throw new DomainError('Invalid history cursor.');
  return getDb()
    .select({
      event: trackingEvents,
      title: media.title,
      kind: media.kind,
      posterPath: media.posterPath,
    })
    .from(trackingEvents)
    .innerJoin(media, eq(media.id, trackingEvents.mediaId))
    .where(
      and(
        eq(trackingEvents.userId, userId),
        options.mediaId ? eq(trackingEvents.mediaId, options.mediaId) : undefined,
        options.before
          ? sql`${trackingEvents.occurredAt} < ${new Date(options.before)}`
          : undefined,
        options.reviewOnly
          ? and(eq(trackingEvents.applied, false), isNull(trackingEvents.reviewedAt))
          : undefined
      )
    )
    .orderBy(desc(trackingEvents.occurredAt), desc(trackingEvents.id))
    .limit(limit);
}

/** Rebuild only viewing fields; saved lists, favourites and drop choices are independent. */
export async function rebuildHistoryInTransaction(
  tx: Transaction,
  userId: string,
  mediaIds: string[],
  removed: (typeof trackingEvents.$inferSelect)[] = []
) {
  for (const mediaId of mediaIds) {
    const previous = await ensureProjection(tx, userId, mediaId);
    const events = await tx
      .select()
      .from(trackingEvents)
      .where(
        and(
          eq(trackingEvents.userId, userId),
          eq(trackingEvents.mediaId, mediaId),
          eq(trackingEvents.applied, true)
        )
      )
      .orderBy(asc(trackingEvents.createdAt), asc(trackingEvents.id));
    const replay = (history: typeof events) =>
      history.reduce(
        (state, event) =>
          projectTracking(state, {
            action: event.action,
            value: event.value ?? undefined,
            rewatch: event.rewatch,
            positionSeconds: event.positionSeconds ?? undefined,
            durationSeconds: event.durationSeconds ?? undefined,
            occurredAt: event.occurredAtKnown ? event.occurredAt : null,
          }).state,
        emptyTrackingState()
      );
    const state = replay(events);
    const deleted = removed.filter((event) => event.mediaId === mediaId && event.applied);
    const original = replay(
      [...events, ...deleted].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
      )
    );
    // Jellyfin supplies a cumulative count, not an event for each historical play.
    // Keep that surplus unless its imported watch summary is explicitly removed.
    if (!deleted.some((event) => event.action === 'watch' && event.source === 'jellyfin'))
      state.playCount += Math.max(0, previous.playCount - original.playCount);
    await tx
      .update(trackingState)
      .set({
        watched: state.watched,
        playCount: state.playCount,
        positionSeconds: state.positionSeconds,
        durationSeconds: state.durationSeconds ?? previous.durationSeconds,
        lastWatchedAt: state.lastWatchedAt,
        updatedAt: new Date(),
      })
      .where(trackingKey(userId, mediaId));
    // Old edition-specific seeks must not override the rebuilt canonical position.
    await tx
      .delete(editionProgress)
      .where(and(eq(editionProgress.userId, userId), eq(editionProgress.mediaId, mediaId)));
  }
  await refreshAncestors(tx, userId, mediaIds, true);
}
