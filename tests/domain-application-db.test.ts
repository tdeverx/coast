import { fallbackArtwork } from '../src/lib/providers/tmdb/fallback.server';
import { cardArtwork, orderedArtwork, overlayArtwork } from '../src/lib/ui/artwork-priority';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { createLocalMedia } from '../src/lib/core/media/service';
import { detailsData, mediaViews } from '../src/lib/server/queries/media';
import { profileData } from '../src/lib/server/queries/profile';
import { profileUser } from '../src/lib/server/queries/profile-user';
import { progressData } from '../src/lib/server/queries/progress';
import { setUpNext } from '../src/lib/core/lists/up-next';
import { homeData } from '../src/lib/server/queries/home';
import { libraryData } from '../src/lib/server/queries/library';
import { listsData, userLists } from '../src/lib/server/queries/lists';
import { requestList } from '../src/lib/server/queries/requests';
import { bulkTrack, track } from '../src/lib/core/tracking/service';
import { moveListItem } from '../src/lib/core/lists/service';
import { savePresentationPreference } from '../src/lib/catalogue/overrides/service';
import { searchMedia, resolveDiscoveryItems } from '../src/lib/catalogue/service';

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('application PostgreSQL read models', () => {
  const a = crypto.randomUUID(),
    b = crypto.randomUUID(),
    c = crypto.randomUUID();
  const instance = crypto.randomUUID(),
    connectionA = crypto.randomUUID(),
    connectionB = crypto.randomUUID();
  const movie = crypto.randomUUID(),
    show = crypto.randomUUID(),
    season = crypto.randomUUID(),
    completeShow = crypto.randomUUID(),
    completeSeason = crypto.randomUUID();
  const episodeOne = crypto.randomUUID(),
    episodeTwo = crypto.randomUUID(),
    special = crypto.randomUUID(),
    completeEpisode = crypto.randomUUID();
  const collection = crypto.randomUUID(),
    anchor = crypto.randomUUID(),
    recommendation = crypto.randomUUID(),
    droppedRecommendation = crypto.randomUUID(),
    privateMovie = crypto.randomUUID();
  const ids: string[] = [
    movie,
    show,
    season,
    completeShow,
    completeSeason,
    episodeOne,
    episodeTwo,
    special,
    completeEpisode,
    collection,
    anchor,
    recommendation,
    droppedRecommendation,
    privateMovie,
  ];
  const genre = `Domain genre ${a}`;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await closeDb();
    process.env.DATABASE_URL = databaseUrl!;
    await migrate(getDb(), { migrationsFolder: `${import.meta.dir}/../drizzle` });
    await getDb()
      .insert(s.users)
      .values([
        { id: a, username: `app-${a}`, passwordHash: 'unused' },
        { id: b, username: `app-${b}`, passwordHash: 'unused' },
        { id: c, username: `app-${c}`, passwordHash: 'unused' },
      ]);
    await getDb()
      .insert(s.media)
      .values([
        { id: movie, kind: 'movie', title: 'Partial movie', runtimeMinutes: 20 },
        { id: show, kind: 'show', title: 'Available show' },
        { id: season, kind: 'season', title: 'Season 1' },
        { id: completeShow, kind: 'show', title: 'Completed show' },
        { id: completeSeason, kind: 'season', title: 'Complete season' },
        { id: episodeOne, kind: 'episode', title: 'Regular episode 1' },
        { id: episodeTwo, kind: 'episode', title: 'Regular episode 2' },
        { id: special, kind: 'episode', title: 'Special' },
        { id: completeEpisode, kind: 'episode', title: 'Complete episode' },
        { id: collection, kind: 'collection', title: 'Mixed collection' },
        { id: anchor, kind: 'movie', title: 'Recommendation anchor', genres: [genre] },
        { id: recommendation, kind: 'movie', title: 'Recommended movie' },
        {
          id: droppedRecommendation,
          kind: 'movie',
          title: 'Dropped recommendation',
          genres: [genre],
        },
        { id: privateMovie, kind: 'movie', title: 'Second user movie' },
      ]);
    await getDb()
      .insert(s.metadataSnapshots)
      .values({
        mediaId: recommendation,
        provider: 'tmdb',
        title: 'Recommended movie',
        genres: [genre],
      });
    await getDb()
      .insert(s.movies)
      .values(
        [movie, anchor, recommendation, droppedRecommendation, privateMovie].map((mediaId) => ({
          mediaId,
        }))
      );
    await getDb()
      .insert(s.shows)
      .values([{ mediaId: show }, { mediaId: completeShow }]);
    await getDb()
      .insert(s.seasons)
      .values([
        { mediaId: season, showId: show, seasonNumber: 1 },
        { mediaId: completeSeason, showId: completeShow, seasonNumber: 1 },
      ]);
    await getDb()
      .insert(s.episodes)
      .values([
        {
          mediaId: episodeOne,
          showId: show,
          seasonId: season,
          seasonNumber: 1,
          episodeNumber: 1,
          runtimeMinutes: 30,
        },
        {
          mediaId: episodeTwo,
          showId: show,
          seasonId: season,
          seasonNumber: 1,
          episodeNumber: 2,
          runtimeMinutes: 30,
        },
        { mediaId: special, showId: show, seasonNumber: 0, episodeNumber: 1, isSpecial: true },
        {
          mediaId: completeEpisode,
          showId: completeShow,
          seasonId: completeSeason,
          seasonNumber: 1,
          episodeNumber: 1,
        },
      ]);
    await getDb()
      .insert(s.mediaRelationships)
      .values([
        { parentId: collection, childId: movie, kind: 'collection', position: 0 },
        { parentId: collection, childId: show, kind: 'collection', position: 1 },
      ]);
    await getDb().insert(s.providerInstances).values({
      id: instance,
      provider: 'jellyfin',
      name: 'Domain library',
      baseUrl: 'https://jellyfin.example.test',
    });
    await getDb()
      .insert(s.providerConnections)
      .values([
        { id: connectionA, userId: a, instanceId: instance },
        { id: connectionB, userId: b, instanceId: instance },
      ]);
    const providerItems = await getDb()
      .insert(s.providerItems)
      .values(
        [show, season, episodeOne, episodeTwo, special, privateMovie].map((mediaId) => ({
          mediaId,
          instanceId: instance,
          externalId: mediaId,
          snapshot: {
            artwork:
              mediaId === show
                ? {
                    primary: '/show-poster',
                    backdrop: '/show-backdrop',
                    thumb: '/show-thumb',
                    logo: '/show-logo',
                  }
                : mediaId === season
                  ? { primary: '/season-poster' }
                  : mediaId === episodeTwo
                    ? {}
                    : {
                        ...(mediaId === episodeOne ? { primary: '/episode-still' } : {}),
                        logo: `/api/v1/artwork/${instance}/${mediaId}/logo?tag=test`,
                      },
          },
          kind:
            mediaId === show
              ? ('show' as const)
              : mediaId === season
                ? ('season' as const)
                : mediaId === privateMovie
                  ? ('movie' as const)
                  : ('episode' as const),
        }))
      )
      .returning();
    await getDb()
      .insert(s.availability)
      .values(
        providerItems.map((item) => ({
          userId: item.mediaId === privateMovie ? b : a,
          connectionId: item.mediaId === privateMovie ? connectionB : connectionA,
          mediaId: item.mediaId,
          providerItemId: item.id,
        }))
      );
  });
  test('username profiles expose subject activity using the signed-in visitors source permissions', async () => {
    await getDb()
      .insert(s.trackingState)
      .values({ userId: b, mediaId: privateMovie, watched: true, favourite: true })
      .onConflictDoUpdate({
        target: [s.trackingState.userId, s.trackingState.mediaId],
        set: { watched: true, favourite: true },
      });
    const subject = await profileUser(('app-' + b).toUpperCase());
    expect(subject.id).toBe(b);
    const profile = await profileData(b, { view: 'favourites' }, new Date(), a);
    const card = profile.favourites.find((item) => item.id === privateMovie);
    expect(card?.favourite).toBe(true);
    expect(card?.available).toBe(false);
    expect(card?.artwork?.logo).toBeUndefined();
    expect(
      (await progressData(b, { view: 'finished' }, a)).items.find(
        (item) => item.id === privateMovie
      )?.available
    ).toBe(false);
    expect(
      (await progressData(b, { view: 'finished', scope: 'available' }, a)).items.some(
        (item) => item.id === privateMovie
      )
    ).toBe(false);
    expect(
      (await progressData(b, { view: 'finished', scope: 'available' }, b)).items.some(
        (item) => item.id === privateMovie
      )
    ).toBe(true);
    await expect(profileUser('missing-' + crypto.randomUUID())).rejects.toMatchObject({
      status: 404,
    });
    await getDb().update(s.users).set({ disabled: true }).where(eq(s.users.id, b));
    try {
      await expect(profileUser('app-' + b)).rejects.toMatchObject({ status: 404 });
    } finally {
      await getDb().update(s.users).set({ disabled: false }).where(eq(s.users.id, b));
    }
    await getDb()
      .delete(s.trackingState)
      .where(and(eq(s.trackingState.userId, b), eq(s.trackingState.mediaId, privateMovie)));
  });
  test('Continue and favourites order by viewing dates including episode activity, not metadata or unrelated state edits', async () => {
    const older = crypto.randomUUID(),
      unwatched = crypto.randomUUID(),
      series = crypto.randomUUID(),
      seasonId = crypto.randomUUID(),
      e1 = crypto.randomUUID(),
      e2 = crypto.randomUUID();
    ids.push(older, unwatched, series, seasonId, e1, e2);
    await getDb()
      .insert(s.media)
      .values([
        { id: older, kind: 'movie', title: 'Older viewing' },
        { id: unwatched, kind: 'movie', title: 'Never viewed', updatedAt: new Date('2090-01-01') },
        { id: series, kind: 'show', title: 'Recently viewed series' },
        { id: seasonId, kind: 'season', title: 'Season' },
        { id: e1, kind: 'episode', title: 'Finished episode' },
        { id: e2, kind: 'episode', title: 'Next episode' },
      ]);
    await getDb()
      .insert(s.movies)
      .values([{ mediaId: older }, { mediaId: unwatched }]);
    await getDb().insert(s.shows).values({ mediaId: series });
    await getDb().insert(s.seasons).values({ mediaId: seasonId, showId: series, seasonNumber: 1 });
    await getDb()
      .insert(s.episodes)
      .values(
        [e1, e2].map((mediaId, i) => ({
          mediaId,
          showId: series,
          seasonId,
          seasonNumber: 1,
          episodeNumber: i + 1,
        }))
      );
    await getDb()
      .insert(s.trackingState)
      .values([
        {
          userId: b,
          mediaId: older,
          favourite: true,
          positionSeconds: 30,
          durationSeconds: 1200,
          updatedAt: new Date('2090-01-01'),
        },
        { userId: b, mediaId: unwatched, favourite: true },
        { userId: b, mediaId: series, favourite: true },
        { userId: b, mediaId: e1, watched: true, positionSeconds: 1200, durationSeconds: 1200 },
      ]);
    await getDb()
      .insert(s.trackingEvents)
      .values([
        {
          userId: b,
          mediaId: older,
          action: 'progress',
          positionSeconds: 30,
          occurredAt: new Date('2020-01-01'),
        },
        { userId: b, mediaId: e1, action: 'watch', occurredAt: new Date('2021-01-01') },
        {
          userId: b,
          mediaId: unwatched,
          action: 'favourite',
          value: true,
          occurredAt: new Date('2025-01-01'),
        },
        {
          userId: b,
          mediaId: older,
          action: 'progress',
          positionSeconds: 60,
          occurredAt: new Date('2080-01-01'),
          occurredAtKnown: false,
        },
        {
          userId: b,
          mediaId: older,
          action: 'watch',
          occurredAt: new Date('2080-01-01'),
          applied: false,
        },
      ]);
    const favourites = (await progressData(b, { view: 'favourites' })).items
      .map((item) => item.id)
      .filter((id) => ([older, unwatched, series] as string[]).includes(id));
    expect(favourites).toEqual([series, older, unwatched]);
    const watching = (await progressData(b)).items
      .map((item) => item.id)
      .filter((id) => ([older, e2] as string[]).includes(id));
    expect(watching).toEqual([e2, older]);
    await getDb()
      .delete(s.media)
      .where(inArray(s.media.id, [older, unwatched, series, seasonId, e1, e2]));
  });
  test('Progress separates collection handoffs and consumes explicit queues without changing saved lists', async () => {
    const first = crypto.randomUUID(),
      next = crypto.randomUUID(),
      group = crypto.randomUUID();
    ids.push(first, next, group);
    await getDb()
      .insert(s.media)
      .values([
        { id: first, kind: 'movie', title: 'Queue first' },
        { id: next, kind: 'movie', title: 'Queue next' },
        { id: group, kind: 'collection', title: 'Queue collection' },
      ]);
    await getDb()
      .insert(s.movies)
      .values([{ mediaId: first }, { mediaId: next }]);
    await getDb()
      .insert(s.mediaRelationships)
      .values([
        { parentId: group, childId: first, kind: 'collection', position: 0 },
        { parentId: group, childId: next, kind: 'collection', position: 1 },
      ]);
    await track(b, { mediaId: first, action: 'watch', acknowledged: true });
    expect((await progressData(b)).items.some((item) => item.id === next)).toBe(false);
    expect(
      (await progressData(b, { view: 'up-next' })).items.some((item) => item.id === next)
    ).toBe(true);
    expect(
      (await progressData(b, { view: 'up-next', scope: 'available' })).items.some(
        (item) => item.id === next
      )
    ).toBe(false);
    await track(b, { mediaId: next, action: 'watchlist', value: true });
    await track(b, { mediaId: next, action: 'favourite', value: true });
    await setUpNext(b, { mediaId: next, queued: true });
    await setUpNext(b, { mediaId: next, queued: true });
    const upNext = (await progressData(b, { view: 'up-next' })).items.filter(
      (item) => item.id === next
    );
    expect(upNext).toHaveLength(1);
    expect(upNext[0].queued).toBe(true);
    expect(
      (await progressData(a, { view: 'up-next' })).items.some((item) => item.id === next)
    ).toBe(false);
    await track(b, {
      mediaId: next,
      action: 'progress',
      positionSeconds: 100,
      durationSeconds: 1200,
    });
    expect((await progressData(b)).items.some((item) => item.id === next)).toBe(true);
    expect(
      (await progressData(b, { view: 'up-next' })).items.some((item) => item.id === next)
    ).toBe(false);
    const [item] = await mediaViews(b, { ids: [next] });
    expect(item.queued).toBe(false);
    expect(item.watchlist).toBe(true);
    expect(item.favourite).toBe(true);
  });
  test('Progress hands a finished season to Up next, then returns its started episodes to Watching', async () => {
    const showId = crypto.randomUUID(),
      firstSeason = crypto.randomUUID(),
      secondSeason = crypto.randomUUID(),
      thirdSeason = crypto.randomUUID(),
      e1 = crypto.randomUUID(),
      e2 = crypto.randomUUID(),
      e3 = crypto.randomUUID();
    ids.push(showId, firstSeason, secondSeason, thirdSeason, e1, e2, e3);
    await getDb()
      .insert(s.media)
      .values([
        { id: showId, kind: 'show', title: 'Queue show' },
        ...[firstSeason, secondSeason, thirdSeason].map((id, i) => ({
          id,
          kind: 'season' as const,
          title: 'Named season ' + i,
        })),
        ...[e1, e2, e3].map((id, i) => ({ id, kind: 'episode' as const, title: 'Episode ' + i })),
      ]);
    await getDb().insert(s.shows).values({ mediaId: showId });
    await getDb()
      .insert(s.seasons)
      .values(
        [firstSeason, secondSeason, thirdSeason].map((mediaId, i) => ({
          mediaId,
          showId,
          seasonNumber: i + 1,
        }))
      );
    await getDb()
      .insert(s.episodes)
      .values(
        [e1, e2, e3].map((mediaId, i) => ({
          mediaId,
          showId,
          seasonId: [firstSeason, secondSeason, thirdSeason][i],
          seasonNumber: i + 1,
          episodeNumber: 1,
        }))
      );
    await track(b, { mediaId: e1, action: 'watch', acknowledged: true });
    let upcoming = (await progressData(b, { view: 'up-next', kind: 'show' })).items.filter(
      (item) => item.showId === showId
    );
    expect(upcoming.map((item) => item.id)).toEqual([secondSeason]);
    expect(upcoming[0].captionTitle).toBe('Queue show');
    expect(upcoming[0].captionSubtitle).toBe('Named season 1');
    await setUpNext(b, { mediaId: secondSeason, queued: true });
    await setUpNext(b, { mediaId: showId, queued: true });
    await track(b, {
      mediaId: e2,
      action: 'progress',
      positionSeconds: 60,
      durationSeconds: 1200,
      acknowledged: true,
    });
    expect(
      (await progressData(b, { view: 'up-next' })).items.some(
        (item) => item.showId === showId || item.id === showId
      )
    ).toBe(false);
    const watching = (await progressData(b)).items.find((item) => item.id === e2);
    expect(watching?.captionSubtitle).toBe('S02E01 Episode 1');
    expect(
      (await mediaViews(b, { ids: [showId, secondSeason] })).every((item) => !item.queued)
    ).toBe(true);
    await setUpNext(a, { mediaId: e3, queued: true });
    await setUpNext(a, { mediaId: e3, queued: false });
    expect((await mediaViews(a, { ids: [e3] }))[0].queued).toBe(false);
  });
  test('artwork is batched with cards and isolated to permitted library sources', async () => {
    const [owner] = await mediaViews(b, { ids: [privateMovie] });
    const [other] = await mediaViews(a, { ids: [privateMovie] });
    expect(owner.artwork?.logo).toContain('/logo?tag=test');
    expect(owner.logo).toBe(owner.artwork?.logo);
    expect(other.artwork).toBeUndefined();
    expect(other.logo).toBeUndefined();
  });
  test('artwork inherits episode to season to show per image type without leaking private artwork', async () => {
    const cards = await mediaViews(a, { ids: [season, episodeOne, episodeTwo, special] });
    const byId = new Map(cards.map((item) => [item.id, item]));
    expect(byId.get(season)?.poster).toBe('/season-poster');
    expect(byId.get(season)?.backdrop).toBe('/show-backdrop');
    expect(byId.get(episodeTwo)?.poster).toBe('/season-poster');
    expect(byId.get(episodeOne)?.artwork?.thumb).toBe('/episode-still');
    const episode = byId.get(episodeOne)!;
    expect(orderedArtwork(episode, 'season-show-episode').map((images) => images.thumb)).toEqual([
      undefined,
      '/show-thumb',
      '/episode-still',
    ]);
    expect(orderedArtwork(episode, 'episode-season-show')[0].thumb).toBe('/episode-still');
    expect(orderedArtwork(episode, 'show-episode-season')[0].thumb).toBe('/show-thumb');
    expect(orderedArtwork(episode)).toEqual([]);
    expect(episode.artworkSources?.season?.logo).toBeUndefined();
    expect(overlayArtwork(episode, 'logo', 'episode-season-show')).toEqual([
      `/api/v1/artwork/${instance}/${episodeOne}/logo?tag=test`,
      '/show-logo',
    ]);
    expect(overlayArtwork(episode, 'art', 'episode-season-show')).toEqual([]);
    expect(cardArtwork(episode, 'thumb', 'fanart', 'season-show-episode').candidates[0]).toBe(
      '/show-thumb'
    );
    expect(cardArtwork(episode, 'thumb', 'fanart', 'episode-season-show').candidates[0]).toBe(
      '/episode-still'
    );
    expect(cardArtwork(episode, 'primary', 'fanart', 'season-show-episode').candidates[0]).toBe(
      '/season-poster'
    );
    expect(cardArtwork(episode, 'none', 'fanart', 'show-season-episode').candidates).toEqual([]);
    expect(cardArtwork(episode, 'screenshot', 'fanart', 'show-season-episode').candidates[0]).toBe(
      '/show-backdrop'
    );

    expect(byId.get(episodeOne)?.artworkSources?.season?.thumb).toBeUndefined();
    expect(byId.get(episodeTwo)?.artworkSources?.season?.thumb).toBeUndefined();
    expect(byId.get(special)?.artworkSources?.show?.thumb).toBe('/show-thumb');
    expect(byId.get(episodeTwo)?.artwork?.thumb).toBe('/show-thumb');
    expect(byId.get(special)?.artwork?.thumb).toBe('/show-thumb');
    expect(byId.get(episodeTwo)?.backdrop).toBe('/show-backdrop');
    expect(byId.get(episodeTwo)?.logo).toBe('/show-logo');
    expect(byId.get(episodeOne)?.logo).toContain(`/` + episodeOne + '/logo?tag=test');
    expect(byId.get(special)?.poster).toBe('/show-poster');
    const [other] = await mediaViews(b, { ids: [episodeTwo] });
    expect(other.artwork).toBeUndefined();
    expect(
      Object.values(other.artworkSources ?? {}).every(
        (images) => !Object.values(images).some(Boolean)
      )
    ).toBe(true);
  });
  test('TMDB thumbnail fallback checks parent thumbnails before substituting backdrops', async () => {
    const snapshots = await getDb()
      .insert(s.metadataSnapshots)
      .values([
        {
          mediaId: episodeOne,
          provider: 'tmdb',
          language: 'en-US',
          region: 'GB',
          raw: {
            artwork: { backdrop: 'https://image.tmdb.org/t/p/original/episode-background.jpg' },
            artworkUpdatedAt: new Date().toISOString(),
          },
        },
        {
          mediaId: season,
          provider: 'tmdb',
          language: 'en-US',
          region: 'GB',
          raw: {
            artwork: { backdrop: 'https://image.tmdb.org/t/p/original/season-background.jpg' },
            artworkUpdatedAt: new Date().toISOString(),
          },
        },
        {
          mediaId: show,
          provider: 'tmdb',
          language: 'en-US',
          region: 'GB',
          raw: {
            artwork: {
              thumb: 'https://image.tmdb.org/t/p/w780/show-thumbnail.jpg',
              art: 'https://image.tmdb.org/t/p/original/show-art.png',
            },
            artworkUpdatedAt: new Date().toISOString(),
          },
        },
      ])
      .returning({ id: s.metadataSnapshots.id });
    try {
      const response = await fallbackArtwork(episodeOne, 'thumb');
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toContain('/w780/show-thumbnail.jpg');
      const [card] = await mediaViews(a, { ids: [show] });
      expect(card.artwork?.art).toContain('/original/show-art.png');
      expect(card.artwork?.thumb).toBe('/show-thumb');
    } finally {
      await getDb()
        .delete(s.metadataSnapshots)
        .where(
          inArray(
            s.metadataSnapshots.id,
            snapshots.map((snapshot) => snapshot.id)
          )
        );
    }
  });
  afterAll(async () => {
    await getDb()
      .delete(s.users)
      .where(inArray(s.users.id, [a, b, c]));
    await getDb().delete(s.providerInstances).where(eq(s.providerInstances.id, instance));
    await getDb().delete(s.media).where(inArray(s.media.id, ids));
    await closeDb();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  test('show availability comes from permitted episodes and remains isolated per user', async () => {
    const [viewA] = await mediaViews(a, { ids: [show] });
    expect(viewA.available).toBe(true);
    expect(viewA.availableSources).toEqual(['Domain library']);
    expect((await mediaViews(b, { ids: [show] }))[0].available).toBe(false);
    expect((await mediaViews(a, { ids: [privateMovie] }))[0].available).toBe(false);
    expect((await mediaViews(b, { ids: [privateMovie] }))[0].available).toBe(true);
    await getDb()
      .update(s.providerConnections)
      .set({ status: 'disconnected' })
      .where(eq(s.providerConnections.id, connectionA));
    expect((await mediaViews(a, { ids: [show] }))[0].available).toBe(false);
    await getDb()
      .update(s.providerConnections)
      .set({ status: 'connected' })
      .where(eq(s.providerConnections.id, connectionA));
  });
  test('a saved show hero has an actionable regular next episode and advances after completion', async () => {
    await track(a, { mediaId: show, action: 'watchlist' });
    const home = await homeData(a);
    expect(home.hero?.id).toBe(show);
    expect(home.heroNext?.id).toBe(episodeOne);
    expect(home.heroNext?.seasonNumber).toBe(1);
    await track(a, { mediaId: episodeOne, action: 'watch' });
    expect((await detailsData(a, show)).next?.id).toBe(episodeTwo);
    const continuedHome = await homeData(a);
    expect(continuedHome.hero?.id).toBe(show);
    expect(continuedHome.hero?.kind).toBe('show');
    const continuing = continuedHome.continueWatching.find((item) => item.id === episodeTwo);
    expect(continuing?.title).toBe('Regular episode 2');
    expect(continuing?.captionTitle).toBe('Available show');
    expect(continuing?.captionSubtitle).toBe('S01E02 Regular episode 2');
    await track(a, { mediaId: episodeOne, action: 'unwatch', acknowledged: true });
  });
  test('partial movies remain saved while completed shows leave the ordinary saved shelf', async () => {
    await track(a, { mediaId: movie, action: 'watchlist' });
    await track(a, {
      mediaId: movie,
      action: 'progress',
      positionSeconds: 120,
      durationSeconds: 1200,
    });
    await track(a, { mediaId: completeShow, action: 'watchlist' });
    await bulkTrack(a, { mediaId: completeShow, action: 'watch' });
    const home = await homeData(a);
    expect(home.watchlist.map((item) => item.id)).toContain(movie);
    expect(home.continueWatching.map((item) => item.id)).toContain(movie);
    expect(home.watchlist.map((item) => item.id)).not.toContain(completeShow);
    expect((await mediaViews(a, { ids: [completeShow] }))[0].watchlist).toBe(true);
  });
  test('collections infer availability and aggregate canonical descendant progress once', async () => {
    const [view] = await mediaViews(a, { ids: [collection] });
    expect(view.available).toBe(true);
    expect(view.progress).toBe(120);
    expect(view.duration).toBe(4800);
    expect(view.watched).toBe(false);
    expect((await detailsData(a, collection)).next?.id).toBe(movie);
    expect((await detailsData(a, collection)).next?.available).toBe(false);
    expect((await mediaViews(b, { ids: [collection] }))[0].available).toBe(false);
  });
  test('media details show ordered collection members with viewer-specific state', async () => {
    const details = await detailsData(a, movie);
    expect(details.collections).toHaveLength(1);
    expect(details.collections[0].id).toBe(collection);
    expect(details.collections[0].title).toBe('Mixed collection');
    expect(details.collections[0].items.map((item) => item.id)).toEqual([
      movie,
      episodeOne,
      episodeTwo,
    ]);
    expect(details.collections[0].items[0].progress).toBe(120);
    expect(details.collections[0].items[1].available).toBe(true);
    const otherViewer = await detailsData(b, movie);
    expect(otherViewer.collections[0].items.every((item) => !item.available)).toBe(true);
    expect(otherViewer.collections[0].items.every((item) => item.progress === 0)).toBe(true);
    expect((await detailsData(a, privateMovie)).collections).toEqual([]);
  });
  test('a partial rewatch returns to Continue Watching without losing canonical completion', async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    await getDb().insert(s.media).values({ id, kind: 'movie', title: 'A rewatched movie' });
    await getDb().insert(s.movies).values({ mediaId: id });
    await track(a, { mediaId: id, action: 'watch', durationSeconds: 1200 });
    expect((await homeData(a)).continueWatching.some((item) => item.id === id)).toBe(false);
    await track(a, {
      mediaId: id,
      action: 'progress',
      positionSeconds: 180,
      durationSeconds: 1200,
      acknowledged: true,
    });
    const resumed = (await homeData(a)).continueWatching.find((item) => item.id === id);
    expect(resumed?.progress).toBe(180);
    expect(resumed?.watched).toBe(true);
    const [state] = await getDb()
      .select()
      .from(s.trackingState)
      .where(and(eq(s.trackingState.userId, a), eq(s.trackingState.mediaId, id)));
    expect(state.playCount).toBe(1);
    await track(a, { mediaId: id, action: 'watch', rewatch: true });
    expect((await homeData(a)).continueWatching.some((item) => item.id === id)).toBe(false);
  });
  test('search includes original and personal titles without leaking another users preference', async () => {
    const originalTitle = `Original ${a}`;
    const personalTitle = `Personal ${a}`;
    const privateTitle = `Private ${b}`;
    await getDb()
      .insert(s.metadataSnapshots)
      .values({ mediaId: movie, provider: 'tmdb', title: 'Translated movie', originalTitle });
    await savePresentationPreference(a, movie, { title: personalTitle });
    await savePresentationPreference(b, privateMovie, { title: privateTitle });
    const adminTitle = `Administrator ${a}`;
    await getDb()
      .insert(s.metadataOverrides)
      .values({ mediaId: recommendation, title: adminTitle });
    expect((await searchMedia(a, originalTitle)).items.map((item) => item.id)).toContain(movie);
    expect((await searchMedia(a, personalTitle)).items[0].title).toBe(personalTitle);
    expect((await searchMedia(a, adminTitle)).items[0].id).toBe(recommendation);
    expect((await searchMedia(a, privateTitle)).items).toHaveLength(0);
    expect((await searchMedia(b, privateTitle)).items[0].id).toBe(privateMovie);
    expect((await searchMedia(a, personalTitle)).truncated).toBe(false);
  });
  test('local same-genre recommendations use Coast history and omit watched or dropped candidates', async () => {
    await track(a, { mediaId: anchor, action: 'watch' });
    await track(a, { mediaId: droppedRecommendation, action: 'drop' });
    await track(b, { mediaId: recommendation, action: 'watch' });
    const suggestions = (await homeData(a)).recommendations;
    expect(suggestions?.because).toBe('Recommendation anchor');
    expect(suggestions?.items.map((item) => item.id)).toEqual([recommendation]);
  });
  test('manual title creation stores its subtype and initial saved event atomically', async () => {
    const created = await createLocalMedia(a, { title: 'Standalone test', kind: 'movie' });
    ids.push(created.id);
    expect(
      await getDb().select().from(s.movies).where(eq(s.movies.mediaId, created.id))
    ).toHaveLength(1);
    const [event] = await getDb()
      .select()
      .from(s.trackingEvents)
      .where(and(eq(s.trackingEvents.userId, a), eq(s.trackingEvents.mediaId, created.id)));
    expect(event.action).toBe('watchlist');
    await getDb().update(s.users).set({ disabled: true }).where(eq(s.users.id, b));
    await expect(
      createLocalMedia(b, { title: 'Should not exist', kind: 'show' })
    ).rejects.toMatchObject({ status: 401 });
  });
  test('details and ordered custom lists retain every item beyond the 500-row query batch', async () => {
    const longShow = crypto.randomUUID(),
      longSeason = crypto.randomUUID();
    const episodeIds = Array.from({ length: 501 }, () => crypto.randomUUID());
    ids.push(longShow, longSeason, ...episodeIds);
    await getDb()
      .insert(s.media)
      .values([
        { id: longShow, kind: 'show', title: 'Long-running series' },
        { id: longSeason, kind: 'season', title: 'Long season' },
        ...episodeIds.map((id, index) => ({
          id,
          kind: 'episode' as const,
          title: `Episode ${index + 1}`,
        })),
      ]);
    await getDb().insert(s.shows).values({ mediaId: longShow });
    await getDb()
      .insert(s.seasons)
      .values({ mediaId: longSeason, showId: longShow, seasonNumber: 1 });
    await getDb()
      .insert(s.episodes)
      .values(
        episodeIds.map((mediaId, index) => ({
          mediaId,
          showId: longShow,
          seasonId: longSeason,
          seasonNumber: 1,
          episodeNumber: index + 1,
        }))
      );
    const [list] = await getDb()
      .insert(s.lists)
      .values({ userId: a, name: 'All 501 episodes' })
      .returning();
    await getDb()
      .insert(s.listItems)
      .values(episodeIds.map((mediaId, position) => ({ listId: list.id, mediaId, position })));
    const details = await detailsData(a, longShow);
    expect(details.episodes).toHaveLength(501);
    expect(details.episodes.map((episode) => episode.id)).toEqual(episodeIds);
    const listed = (await userLists(a)).find((row) => row.id === list.id);
    expect(listed?.items).toHaveLength(501);
    expect(listed?.items.map((item) => item.id)).toEqual(episodeIds);
    const first = await listsData(a, { view: list.id });
    const showsOnly = await listsData(a, { view: list.id, kind: 'show' });
    expect(showsOnly.total).toBe(first.total);
    expect(showsOnly.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
    const moviesOnly = await listsData(a, { view: list.id, kind: 'movie' });
    expect(moviesOnly.total).toBe(0);
    expect(moviesOnly.items).toHaveLength(0);
    expect(first.items.map((item) => item.id)).toEqual(episodeIds.slice(0, 60));
    expect(first.lists.find((row) => row.id === list.id)?.itemCount).toBe(501);
    expect(first.lists.some((row) => 'items' in row)).toBe(false);
    expect((await listsData(a, { view: list.id, page: 999 })).items.map((item) => item.id)).toEqual(
      episodeIds.slice(480)
    );
    await moveListItem(a, list.id, { entryId: first.items[59].entryId!, direction: 1 });
    expect((await listsData(a, { view: list.id })).items.at(-1)?.id).toBe(episodeIds[60]);
    expect((await listsData(a, { view: list.id, page: 2 })).items[0].id).toBe(episodeIds[59]);
    await moveListItem(a, list.id, { entryId: first.items[59].entryId!, direction: -1 });
    expect((await listsData(a, { view: list.id, page: 2 })).items[0].id).toBe(episodeIds[60]);
    await expect(listsData(b, { view: list.id })).rejects.toMatchObject({ status: 404 });
    await expect(
      moveListItem(b, list.id, { entryId: first.items[0].entryId!, direction: 1 })
    ).rejects.toMatchObject({ status: 404 });
  });
  test('saved pages select user state before paging beyond newer unrelated catalogue titles', async () => {
    const saved = Array.from({ length: 61 }, () => crypto.randomUUID()).sort();
    const unrelated: string[] = Array.from({ length: 501 }, () => crypto.randomUUID());
    ids.push(...saved, ...unrelated);
    await getDb()
      .insert(s.media)
      .values([
        ...saved.map((id) => ({
          id,
          kind: 'movie' as const,
          title: `Saved ${id}`,
          updatedAt: new Date('1990-01-01'),
        })),
        ...unrelated.map((id) => ({ id, kind: 'movie' as const, title: `Unrelated ${id}` })),
      ]);
    await getDb()
      .insert(s.movies)
      .values([...saved, ...unrelated].map((mediaId) => ({ mediaId })));
    await getDb()
      .insert(s.trackingState)
      .values([
        ...saved.map((mediaId) => ({
          userId: c,
          mediaId,
          watchlist: true,
          favourite: true,
          collected: true,
        })),
        { userId: b, mediaId: unrelated[0], watchlist: true, favourite: true, collected: true },
      ]);
    await getDb()
      .insert(s.upNext)
      .values(saved.map((mediaId) => ({ userId: c, mediaId })));
    const queuedFirst = await progressData(c, { view: 'up-next' });
    const queuedLast = await progressData(c, { view: 'up-next', page: 99 });
    expect(queuedFirst.total).toBe(61);
    expect(queuedFirst.items.map((item) => item.id)).toEqual(saved.slice(0, 60));
    expect(queuedLast.page).toBe(2);
    expect(queuedLast.items.map((item) => item.id)).toEqual(saved.slice(60));
    expect((await progressData(c, { view: 'up-next', scope: 'available' })).total).toBe(0);
    for (const view of ['watchlist', 'favourites']) {
      const first = await listsData(c, { view });
      const last = await listsData(c, { view, page: 99 });
      const available = await listsData(c, { view, scope: 'available' });
      expect(available.total).toBe(0);
      expect(available.items).toEqual([]);
      expect(first.total).toBe(61);
      expect(first.items.map((item) => item.id)).toEqual(saved.slice(0, 60));
      expect(last.page).toBe(2);
      expect(last.items.map((item) => item.id)).toEqual(saved.slice(60));
      expect(first.items.some((item) => unrelated.includes(item.id))).toBe(false);
    }
    await getDb()
      .delete(s.media)
      .where(inArray(s.media.id, [...saved, ...unrelated]));
  });
  test('saved filters include partial show and collection progress without losing partial movies', async () => {
    for (const mediaId of [show, movie, collection, completeShow, droppedRecommendation])
      await track(c, { mediaId, action: 'watchlist' });
    await track(c, {
      mediaId: episodeOne,
      action: 'progress',
      positionSeconds: 60,
      durationSeconds: 1800,
    });
    await track(c, {
      mediaId: movie,
      action: 'progress',
      positionSeconds: 60,
      durationSeconds: 1200,
    });
    await bulkTrack(c, { mediaId: completeShow, action: 'watch' });
    await track(c, { mediaId: droppedRecommendation, action: 'drop' });
    const toWatch = (await listsData(c)).items.map((item) => item.id);
    expect(toWatch).toContain(movie);
    expect(toWatch).not.toContain(show);
    const progress = (await listsData(c, { filter: 'progress' })).items.map((item) => item.id);
    expect(progress).toContain(movie);
    expect(progress).toContain(show);
    expect(progress).toContain(collection);
    expect(progress).not.toContain(completeShow);
    expect((await listsData(c, { filter: 'complete' })).items.map((item) => item.id)).toEqual([
      completeShow,
    ]);
    expect((await listsData(c, { filter: 'dropped' })).items.map((item) => item.id)).toEqual([
      droppedRecommendation,
    ]);
  });
  test('requests hydrate only the selected page and exclude another users requests', async () => {
    const requests = Array.from({ length: 61 }, (_, index) => ({
      id: crypto.randomUUID(),
      userId: c,
      mediaId: movie,
      instanceId: instance,
      createdAt: new Date(1700000000000 + index * 1000),
    }));
    await getDb()
      .insert(s.mediaRequests)
      .values([...requests, { userId: b, mediaId: privateMovie, instanceId: instance }]);
    const first = await requestList(c);
    const last = await requestList(c, 999);
    expect(first.total).toBe(61);
    expect(first.requests.map((row) => row.id)).toEqual(
      requests
        .slice(1)
        .reverse()
        .map((row) => row.id)
    );
    expect(first.requests.every((row) => row.item?.id === movie)).toBe(true);
    expect(last.page).toBe(2);
    expect(last.requests.map((row) => row.id)).toEqual([requests[0].id]);
    expect((await requestList(a)).requests).toEqual([]);
  });
  test('library filters precede pagination, including an available title beyond 500 newer catalogue entries', async () => {
    const oldAvailable = crypto.randomUUID();
    const newer = Array.from({ length: 501 }, () => crypto.randomUUID());
    ids.push(oldAvailable, ...newer);
    await getDb()
      .insert(s.media)
      .values([
        {
          id: oldAvailable,
          kind: 'movie',
          title: 'Available beyond the old cap',
          updatedAt: new Date('2000-01-01T00:00:00Z'),
        },
        ...newer.map((id, index) => ({
          id,
          kind: 'movie' as const,
          title: `Newer unavailable catalogue entry ${index}`,
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        })),
      ]);
    await getDb()
      .insert(s.movies)
      .values([oldAvailable, ...newer].map((mediaId) => ({ mediaId })));
    const [providerItem] = await getDb()
      .insert(s.providerItems)
      .values({
        instanceId: instance,
        mediaId: oldAvailable,
        externalId: oldAvailable,
        kind: 'movie',
      })
      .returning();
    await getDb().insert(s.availability).values({
      userId: a,
      connectionId: connectionA,
      providerItemId: providerItem.id,
      mediaId: oldAvailable,
    });
    await track(a, {
      mediaId: oldAvailable,
      action: 'progress',
      positionSeconds: 30,
      durationSeconds: 3600,
    });
    await track(a, { mediaId: oldAvailable, action: 'collect' });
    const available = await libraryData(a, { kind: 'movie', scope: 'available' });
    expect(available.total).toBe(1);
    expect(available.items.map((item) => item.id)).toEqual([oldAvailable]);
    expect(available.providers.map((provider) => provider.id)).toEqual([instance]);
    expect(
      (await libraryData(a, { scope: 'all', source: instance, tracking: 'progress' })).items.map(
        (item) => item.id
      )
    ).toEqual([oldAvailable]);
    expect(
      (await libraryData(a, { kind: 'movie', tracking: 'progress' })).items.map((item) => item.id)
    ).toEqual([oldAvailable]);
    expect((await libraryData(a, { source: crypto.randomUUID() })).total).toBe(0);
    expect((await libraryData(b, { kind: 'movie' })).items.map((item) => item.id)).toEqual([
      privateMovie,
    ]);
    const first = await libraryData(a, { kind: 'movie', scope: 'all' });
    const second = await libraryData(a, { kind: 'movie', scope: 'all', page: 2 });
    expect(first.total).toBeGreaterThan(500);
    expect(first.items).toHaveLength(60);
    expect(second.items).toHaveLength(60);
    expect(
      second.items.some((item) => first.items.some((previous) => previous.id === item.id))
    ).toBe(false);
    const last = await libraryData(a, { kind: 'movie', scope: 'all', page: 999 });
    expect(last.page).toBe(last.pages);
    expect(last.items.map((item) => item.id)).toContain(oldAvailable);
    await getDb()
      .update(s.providerConnections)
      .set({ status: 'disconnected' })
      .where(eq(s.providerConnections.id, connectionA));
    expect((await libraryData(a, { kind: 'movie' })).total).toBe(0);
    await getDb()
      .update(s.providerConnections)
      .set({ status: 'connected' })
      .where(eq(s.providerConnections.id, connectionA));
  });
  test('actual search ranks a permitted show before the 100-result cap and reports truncation', async () => {
    const needle = `Search ranking ${a}`;
    const newer = Array.from({ length: 105 }, () => crypto.randomUUID());
    ids.push(...newer);
    await getDb()
      .insert(s.media)
      .values(
        newer.map((id, index) => ({
          id,
          kind: 'movie' as const,
          title: `${needle} ${index}`,
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        }))
      );
    await getDb()
      .insert(s.movies)
      .values(newer.map((mediaId) => ({ mediaId })));
    await getDb()
      .update(s.media)
      .set({ title: `${needle} available series`, updatedAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(s.media.id, show));
    const result = await searchMedia(a, needle);
    expect(result.items).toHaveLength(100);
    expect(result.truncated).toBe(true);
    expect(result.items[0]).toMatchObject({ id: show, available: true });
    expect(result.providerUnavailable).toBe(false);
    const otherUser = await searchMedia(b, needle);
    expect(otherUser.items.some((item) => item.id === show)).toBe(false);
    expect(otherUser.items.every((item) => !item.available)).toBe(true);
  });
  test('Discover retains ordered provider shelves when newer library imports fill the local fallback', async () => {
    const discovered: string[] = Array.from({ length: 3 }, () => crypto.randomUUID());
    const scanned: string[] = Array.from({ length: 82 }, () => crypto.randomUUID());
    ids.push(...discovered, ...scanned);
    await getDb()
      .insert(s.media)
      .values(
        discovered.map((id, index) => ({
          id,
          kind: 'movie' as const,
          title: `Discovery shelf fixture ${index}`,
          updatedAt: new Date('2001-01-01T00:00:00Z'),
        }))
      );
    // Model a library scan updating more than the fallback capacity after provider ingestion.
    await getDb()
      .insert(s.media)
      .values(
        scanned.map((id, index) => ({
          id,
          kind: 'movie' as const,
          title: `Later library import ${index}`,
          updatedAt: new Date('2030-01-01T00:00:00Z'),
        }))
      );
    await getDb()
      .insert(s.movies)
      .values([...discovered, ...scanned].map((mediaId) => ({ mediaId })));
    const trending = [discovered[1], discovered[0]],
      recent = [discovered[2], discovered[0]];
    const items = await resolveDiscoveryItems([...trending, ...recent]);
    expect(items).toHaveLength(3);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    const views = await mediaViews(a, { ids: items.map((item) => item.id) });
    // Match the route's per-user projection and ordered bucket resolution.
    const projectShelf = (shelf: string[]) =>
      shelf.flatMap((id) =>
        views.find((item) => item.id === id) ? [views.find((item) => item.id === id)!.id] : []
      );
    expect(projectShelf(trending)).toEqual(trending);
    expect(projectShelf(recent)).toEqual(recent);
    const offline = await resolveDiscoveryItems([]);
    expect(offline).toHaveLength(80);
    expect(offline.every((item) => scanned.includes(item.id))).toBe(true);
  });
});
