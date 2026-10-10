import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb } from '../src/lib/server/db';
import {
  editionProgress,
  episodes,
  externalIds,
  listItems,
  media,
  mediaRelationships,
  metadataSnapshots,
  movies,
  seasons,
  shows,
  trackingEvents,
  users,
} from '../src/lib/server/db/schema';
import { AcknowledgementRequired } from '../src/lib/core/errors';
import {
  bulkTrack,
  bulkTrackInTransaction,
  getHistory,
  getTracking,
  track,
  trackInTransaction,
} from '../src/lib/core/tracking/service.server';
import {
  addListItem,
  createList,
  getList,
  removeListItem,
  reorderList,
} from '../src/lib/core/lists/service.server';
import { rate, rateInTransaction } from '../src/lib/core/ratings/service.server';
import {
  getMetadataEditor,
  resetPresentationPreference,
  saveMetadataOverrides,
  savePresentationPreference,
} from '../src/lib/catalogue/overrides/service.server';
import { addLocalSeasonEpisodes } from '../src/lib/core/media/service.server';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('domain PostgreSQL transactions', () => {
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const movieId = crypto.randomUUID();
  const secondMovieId = crypto.randomUUID();
  const showId = crypto.randomUUID();
  const seasonId = crypto.randomUUID();
  const episodeIds = Array.from({ length: 4 }, () => crypto.randomUUID());
  const localShowId = crypto.randomUUID();
  const collectionId = crypto.randomUUID();
  const outerCollectionId = crypto.randomUUID();
  const mediaIds: string[] = [
    movieId,
    secondMovieId,
    showId,
    seasonId,
    localShowId,
    collectionId,
    outerCollectionId,
    ...episodeIds,
  ];
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await closeDb();
    process.env.DATABASE_URL = databaseUrl!;
    await migrate(getDb(), { migrationsFolder: `${import.meta.dir}/../drizzle` });
    await getDb()
      .insert(users)
      .values([
        { id: userId, username: `domain-${userId}`, passwordHash: 'unused-test-hash' },
        { id: otherUserId, username: `domain-${otherUserId}`, passwordHash: 'unused-test-hash' },
        {
          id: adminId,
          username: `domain-${adminId}`,
          role: 'admin',
          passwordHash: 'unused-test-hash',
        },
      ]);
    await getDb()
      .insert(media)
      .values([
        { id: movieId, kind: 'movie', title: 'Domain test movie' },
        { id: secondMovieId, kind: 'movie', title: 'Second domain test movie' },
        { id: showId, kind: 'show', title: 'Domain test show' },
        { id: seasonId, kind: 'season', title: 'Season one' },
        { id: localShowId, kind: 'show', title: 'Manual show' },
        { id: collectionId, kind: 'collection', title: 'Collection' },
        { id: outerCollectionId, kind: 'collection', title: 'Outer collection' },
        ...episodeIds.map((id, i) => ({ id, kind: 'episode' as const, title: `Episode ${i}` })),
      ]);
    await getDb()
      .insert(movies)
      .values([{ mediaId: movieId }, { mediaId: secondMovieId }]);
    await getDb()
      .insert(shows)
      .values([{ mediaId: showId }, { mediaId: localShowId }]);
    await getDb().insert(seasons).values({ mediaId: seasonId, showId, seasonNumber: 1 });
    await getDb()
      .insert(episodes)
      .values(
        episodeIds.map((id, i) => ({
          mediaId: id,
          showId,
          seasonId,
          seasonNumber: i === 3 ? 0 : 1,
          episodeNumber: i + 1,
          isSpecial: i === 3,
        }))
      );
    await getDb()
      .insert(mediaRelationships)
      .values([
        { parentId: collectionId, childId: secondMovieId, kind: 'collection', position: 0 },
        { parentId: collectionId, childId: showId, kind: 'collection', position: 1 },
        { parentId: outerCollectionId, childId: collectionId, kind: 'collection', position: 1 },
        { parentId: outerCollectionId, childId: secondMovieId, kind: 'collection', position: 0 },
      ]);
  });
  afterAll(async () => {
    const addedSeasons = await getDb()
      .select({ id: seasons.mediaId })
      .from(seasons)
      .where(eq(seasons.showId, localShowId));
    const addedEpisodes = await getDb()
      .select({ id: episodes.mediaId })
      .from(episodes)
      .where(eq(episodes.showId, localShowId));
    mediaIds.push(...addedSeasons.map((row) => row.id), ...addedEpisodes.map((row) => row.id));
    await getDb()
      .delete(users)
      .where(inArray(users.id, [userId, otherUserId, adminId]));
    await getDb().delete(media).where(inArray(media.id, mediaIds));
    await closeDb();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  test('concurrent source retries append once and count one play', async () => {
    const input = {
      mediaId: movieId,
      action: 'watch' as const,
      source: 'trakt',
      sourceEventId: 'history-100',
      rewatch: true,
      occurredAt: '2025-03-01T20:00:00Z',
    };
    const results = await Promise.all([
      track(userId, input),
      track(userId, input),
      track(userId, input),
    ]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(2);
    expect((await getTracking(userId, movieId)).playCount).toBe(1);
    const events = await getDb()
      .select()
      .from(trackingEvents)
      .where(
        and(eq(trackingEvents.userId, userId), eq(trackingEvents.sourceEventId, 'history-100'))
      );
    expect(events).toHaveLength(1);
    expect(events[0].occurredAt.toISOString()).toBe('2025-03-01T20:00:00.000Z');
  });
  test('a repeated completion keeps a dropped title dropped; edition progress is independent', async () => {
    await track(userId, { mediaId: movieId, action: 'drop' });
    const repeated = await track(userId, { mediaId: movieId, action: 'watch' });
    expect(repeated.eventId).toBeNull();
    expect(repeated.state.dropped).toBe(true);
    await track(userId, {
      mediaId: movieId,
      action: 'progress',
      editionId: 'theatrical',
      positionSeconds: 200,
      durationSeconds: 1000,
    });
    await track(userId, {
      mediaId: movieId,
      action: 'progress',
      editionId: 'directors-cut',
      positionSeconds: 100,
      durationSeconds: 1100,
    });
    const editions = await getDb()
      .select()
      .from(editionProgress)
      .where(eq(editionProgress.userId, userId));
    expect(editions).toHaveLength(2);
    expect(editions.find((entry) => entry.editionId === 'theatrical')?.positionSeconds).toBe(200);
    const state = await getTracking(userId, movieId);
    expect(state.watched).toBe(true);
    expect(state.dropped).toBe(false);
  });
  test('contradictory imports retain evidence while preserving canonical completion', async () => {
    const input = {
      mediaId: movieId,
      action: 'unwatch' as const,
      source: 'trakt',
      sourceEventId: 'unwatch-100',
    };
    const result = await track(userId, input);
    expect(result.reviewRequired).toBe(true);
    expect(result.state.watched).toBe(true);
    const [event] = await getDb()
      .select()
      .from(trackingEvents)
      .where(eq(trackingEvents.id, result.eventId!));
    expect(event.applied).toBe(false);
    expect(event.reviewReason).toContain('contradicts');
    expect((await track(userId, input)).duplicate).toBe(true);
  });
  test('out-of-order manual episode completion rolls back unless acknowledged', async () => {
    await expect(track(userId, { mediaId: episodeIds[1], action: 'watch' })).rejects.toBeInstanceOf(
      AcknowledgementRequired
    );
    expect((await getTracking(userId, episodeIds[1])).watched).toBe(false);
    await track(userId, { mediaId: showId, action: 'watchlist' });
    await track(userId, { mediaId: episodeIds[0], action: 'watch' });
    expect(await getTracking(userId, showId)).toMatchObject({
      completedEpisodes: 1,
      totalEpisodes: 3,
      watchlist: true,
      watched: false,
    });
    await track(userId, { mediaId: showId, action: 'drop' });
    await track(userId, { mediaId: episodeIds[0], action: 'watch' });
    expect((await getTracking(userId, showId)).dropped).toBe(true);
    await track(userId, {
      mediaId: episodeIds[1],
      action: 'progress',
      positionSeconds: 0,
      durationSeconds: 1800,
    });
    expect((await getTracking(userId, showId)).dropped).toBe(true);
    await track(userId, {
      mediaId: episodeIds[1],
      action: 'progress',
      positionSeconds: 20,
      durationSeconds: 1800,
    });
    expect((await getTracking(userId, showId)).dropped).toBe(false);
  });
  test('bulk actions project regular episodes atomically and exclude specials', async () => {
    const watched = await bulkTrack(userId, { mediaId: showId, action: 'watch' });
    expect(watched).toMatchObject({ changed: 2, total: 3 });
    expect(watched.events.map((event) => event.mediaId)).toEqual([episodeIds[1], episodeIds[2]]);
    const accepted = await getDb()
      .select()
      .from(trackingEvents)
      .where(
        inArray(
          trackingEvents.id,
          watched.events.map((event) => event.eventId)
        )
      );
    expect(accepted).toHaveLength(2);
    expect(
      accepted.every(
        (event) => event.action === 'watch' && event.applied && event.userId === userId
      )
    ).toBe(true);
    expect(await getTracking(userId, showId)).toMatchObject({
      completedEpisodes: 3,
      totalEpisodes: 3,
      watched: true,
      dropped: false,
    });
    expect((await getTracking(userId, seasonId)).watched).toBe(true);
    expect((await getTracking(userId, episodeIds[3])).watched).toBe(false);
    await expect(bulkTrack(userId, { mediaId: showId, action: 'unwatch' })).rejects.toBeInstanceOf(
      AcknowledgementRequired
    );
    expect((await getTracking(userId, showId)).watched).toBe(true);
    await bulkTrack(userId, { mediaId: showId, action: 'unwatch', acknowledged: true });
    expect(await getTracking(userId, showId)).toMatchObject({
      completedEpisodes: 0,
      watched: false,
      playCount: 1,
    });
    const events = await getDb()
      .select()
      .from(trackingEvents)
      .where(and(eq(trackingEvents.userId, userId), inArray(trackingEvents.mediaId, episodeIds)));
    expect(events).toHaveLength(8);
  });
  test('embedding tracking in another transaction rolls back event and projection together', async () => {
    await expect(
      getDb().transaction(async (tx) => {
        await trackInTransaction(tx, userId, { mediaId: secondMovieId, action: 'watchlist' });
        throw new Error('Simulated request/outbox insert failure');
      })
    ).rejects.toThrow('Simulated request');
    expect((await getTracking(userId, secondMovieId)).watchlist).toBe(false);
    const events = await getDb()
      .select()
      .from(trackingEvents)
      .where(and(eq(trackingEvents.userId, userId), eq(trackingEvents.mediaId, secondMovieId)));
    expect(events).toHaveLength(0);
  });
  test('list mutations enforce ownership and exact permutations', async () => {
    const list = await createList(userId, { name: 'Saturday films' });
    await addListItem(userId, list.id, movieId);
    await addListItem(userId, list.id, secondMovieId);
    await addListItem(userId, list.id, movieId);
    expect((await getList(userId, list.id)).items).toHaveLength(2);
    await expect(addListItem(otherUserId, list.id, showId)).rejects.toThrow('not found');
    await expect(getList(otherUserId, list.id)).rejects.toThrow('not found');
    const entries = (await getList(userId, list.id)).items;
    const firstEntry = entries.find((row) => row.item.id === movieId)!.entryId;
    const secondEntry = entries.find((row) => row.item.id === secondMovieId)!.entryId;
    await expect(reorderList(userId, list.id, [firstEntry])).rejects.toThrow('every list item');
    await reorderList(userId, list.id, [secondEntry, firstEntry]);
    const ordered = await getDb()
      .select()
      .from(listItems)
      .where(eq(listItems.listId, list.id))
      .orderBy(asc(listItems.position));
    expect(ordered.map((item) => item.mediaId)).toEqual([secondMovieId, movieId]);
    await removeListItem(userId, list.id, secondEntry);
    expect((await getList(userId, list.id)).items[0].position).toBe(0);
  });
  test('half-star ratings persist and null removes the rating', async () => {
    expect((await rate(userId, { mediaId: movieId, value: 4.5 }))?.value).toBe(4.5);
    await expect(rate(userId, { mediaId: movieId, value: 4.1 })).rejects.toThrow('half-star');
    expect(await rate(userId, { mediaId: movieId, value: null })).toBeNull();
  });
  test('collection bulk operations deduplicate nested leaves and project nested completion', async () => {
    expect(await bulkTrack(userId, { mediaId: outerCollectionId, action: 'watch' })).toMatchObject({
      changed: 4,
      total: 4,
    });
    expect((await getTracking(userId, collectionId)).watched).toBe(true);
    expect((await getTracking(userId, outerCollectionId)).watched).toBe(true);
    await track(userId, { mediaId: outerCollectionId, action: 'drop' });
    expect(await bulkTrack(userId, { mediaId: outerCollectionId, action: 'watch' })).toEqual({
      changed: 0,
      total: 4,
      events: [],
    });
    expect((await getTracking(userId, outerCollectionId)).dropped).toBe(true);
    await track(userId, { mediaId: secondMovieId, action: 'unwatch', acknowledged: true });
    expect((await getTracking(userId, outerCollectionId)).watched).toBe(false);
    expect((await getTracking(userId, outerCollectionId)).dropped).toBe(false);
  });
  test('administrator metadata edits preserve snapshots, enforce locks and require actual DB role', async () => {
    await getDb()
      .insert(metadataSnapshots)
      .values({
        mediaId: movieId,
        provider: 'tmdb',
        title: 'Provider title',
        raw: { boundaryOnly: true },
      });
    await expect(
      saveMetadataOverrides(userId, movieId, { values: { title: 'Unauthorised' }, locks: [] })
    ).rejects.toMatchObject({ status: 403 });
    await expect(getMetadataEditor(userId, movieId)).rejects.toMatchObject({ status: 403 });
    await savePresentationPreference(adminId, movieId, {
      title: 'Personal title',
      posterPath: 'https://example.com/poster.jpg',
    });
    const locked = await saveMetadataOverrides(adminId, movieId, {
      values: { title: 'Shared title' },
      locks: ['title'],
    });
    expect(locked.resolved.values.title).toBe('Shared title');
    expect(locked.resolved.provenance.title?.source).toBe('administrator');
    expect(locked.snapshots[0].title).toBe('Provider title');
    expect('raw' in locked.snapshots[0]).toBe(false);
    const unlocked = await saveMetadataOverrides(adminId, movieId, {
      values: { title: null },
      locks: [],
    });
    expect(unlocked.resolved.values.title).toBe('Personal title');
    await resetPresentationPreference(adminId, movieId);
    expect((await getMetadataEditor(adminId, movieId)).resolved.values.title).toBe(
      'Provider title'
    );
    await getDb().update(users).set({ disabled: true }).where(eq(users.id, otherUserId));
    await expect(
      savePresentationPreference(otherUserId, movieId, { title: 'Disabled user' })
    ).rejects.toMatchObject({ status: 401 });
  });
  test('manual show episode creation is idempotent, preserves IDs and updates completion', async () => {
    const first = await addLocalSeasonEpisodes(userId, localShowId, 1, 3);
    expect(first).toMatchObject({ added: 3, total: 3 });
    const originals = await getDb()
      .select()
      .from(episodes)
      .where(eq(episodes.showId, localShowId))
      .orderBy(asc(episodes.episodeNumber));
    expect(await addLocalSeasonEpisodes(userId, localShowId, 1, 2)).toMatchObject({
      added: 0,
      total: 3,
    });
    await bulkTrack(userId, { mediaId: localShowId, action: 'watch' });
    expect((await getTracking(userId, localShowId)).watched).toBe(true);
    expect(await addLocalSeasonEpisodes(userId, localShowId, 1, 4)).toMatchObject({
      added: 1,
      total: 4,
    });
    const after = await getDb()
      .select()
      .from(episodes)
      .where(eq(episodes.showId, localShowId))
      .orderBy(asc(episodes.episodeNumber));
    expect(after.slice(0, 3).map((episode) => episode.mediaId)).toEqual(
      originals.map((episode) => episode.mediaId)
    );
    expect(await getTracking(userId, localShowId)).toMatchObject({
      watched: false,
      completedEpisodes: 3,
      totalEpisodes: 4,
      playCount: 1,
    });
    await addLocalSeasonEpisodes(userId, localShowId, 0, 1);
    expect((await getTracking(userId, localShowId)).totalEpisodes).toBe(4);
    await getDb()
      .insert(externalIds)
      .values({
        mediaId: localShowId,
        mediaKind: 'show',
        provider: 'tmdb',
        externalId: `domain-${localShowId}`,
      });
    await expect(addLocalSeasonEpisodes(userId, localShowId, 2, 3)).rejects.toThrow(
      'provider-backed'
    );
  });
  test('an already-unwatched no-op never warns or undrops, even with substantial history', async () => {
    await track(userId, { mediaId: movieId, action: 'watch', rewatch: true });
    await track(userId, { mediaId: movieId, action: 'watch', rewatch: true });
    await track(userId, { mediaId: movieId, action: 'unwatch', acknowledged: true });
    await track(userId, { mediaId: movieId, action: 'drop' });
    const noOp = await track(userId, { mediaId: movieId, action: 'unwatch' });
    expect(noOp).toMatchObject({ changed: false, eventId: null, reviewRequired: false });
    expect(noOp.state).toMatchObject({ dropped: true, watched: false, playCount: 3 });
  });
  test('bulk/rating transaction APIs roll back with external enqueue failures and distinguish no-op ratings', async () => {
    const prior = await getTracking(userId, secondMovieId);
    await expect(
      getDb().transaction(async (tx) => {
        await bulkTrackInTransaction(tx, userId, { mediaId: collectionId, action: 'watch' });
        await rateInTransaction(tx, userId, { mediaId: movieId, value: 3.5 });
        throw new Error('Outbox insert failed');
      })
    ).rejects.toThrow('Outbox insert');
    expect((await getTracking(userId, secondMovieId)).watched).toBe(prior.watched);
    expect(
      await getDb().transaction((tx) =>
        rateInTransaction(tx, userId, { mediaId: movieId, value: null })
      )
    ).toEqual({ rating: null, changed: false });
    expect(
      (
        await getDb().transaction((tx) =>
          rateInTransaction(tx, userId, { mediaId: movieId, value: 3.5 })
        )
      ).changed
    ).toBe(true);
    expect(
      (
        await getDb().transaction((tx) =>
          rateInTransaction(tx, userId, { mediaId: movieId, value: 3.5 })
        )
      ).changed
    ).toBe(false);
  });
  test('resolved import reviews do not reopen on retry and remain in the complete audit history', async () => {
    const [original] = await getDb()
      .select()
      .from(trackingEvents)
      .where(
        and(eq(trackingEvents.userId, userId), eq(trackingEvents.sourceEventId, 'unwatch-100'))
      );
    await getDb()
      .update(trackingEvents)
      .set({ reviewedAt: new Date(), reviewDecision: 'ignored' })
      .where(eq(trackingEvents.id, original.id));
    const retried = await track(userId, {
      mediaId: movieId,
      action: 'unwatch',
      source: 'trakt',
      sourceEventId: 'unwatch-100',
    });
    expect(retried).toMatchObject({ duplicate: true, reviewRequired: false, changed: false });
    expect(
      (await getHistory(userId, { reviewOnly: true })).map((row) => row.event.id)
    ).not.toContain(original.id);
    expect((await getHistory(userId, { mediaId: movieId })).map((row) => row.event.id)).toContain(
      original.id
    );
  });
});
