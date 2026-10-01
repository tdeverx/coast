import { setRewatch } from '../src/lib/core/tracking/rewatch';
import { mediaViewsForIds } from '../src/lib/server/queries/media';
import { beforeAll, afterAll, test, expect } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import {
  users,
  media,
  trackingState,
  trackingEvents,
  ratings,
  shows,
  seasons,
  mediaRelationships,
  episodes,
} from '../src/lib/server/db/schema';
import { updateProfile } from '../src/lib/core/profile/service';
import { streamGifAvatar } from '../src/lib/core/profile/gif-avatar.server';
import { track } from '../src/lib/core/tracking/service';
import { progressData } from '../src/lib/server/queries/progress';
import { profileData, profileActivity, profileProgress } from '../src/lib/server/queries/profile';
const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const animatedAvatar = 'R0lGODlhAQABAIAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAQABAAACAkQBACH5BAAUAAAALAAAAAABAAEAAAICTAEAOw==';
let owner: string,
  other: string,
  ids: string[] = [];
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const people = await getDb()
    .insert(users)
    .values(
      ['owner', 'other'].map((name) => ({
        username: `profile-${name}-${crypto.randomUUID()}`,
        passwordHash: 'fixture',
      }))
    )
    .returning();
  [owner, other] = people.map((p) => p.id);
  const items = await getDb()
    .insert(media)
    .values(
      Array.from({ length: 63 }, (_, i) => ({
        kind: 'movie' as const,
        title: `Profile ${i}`,
        genres: ['Drama'],
      }))
    )
    .returning();
  ids = items.map((item) => item.id);
  await getDb()
    .insert(trackingState)
    .values(ids.map((mediaId) => ({ userId: owner, mediaId, watched: true, favourite: true })));
  await getDb()
    .insert(trackingEvents)
    .values([
      ...ids.map((mediaId) => ({
        userId: owner,
        mediaId,
        action: 'watch' as const,
        occurredAt: new Date('2026-09-27T12:00:00Z'),
      })),
      {
        userId: owner,
        mediaId: ids[0],
        action: 'watch',
        occurredAt: new Date('2026-09-27T14:00:00Z'),
      },
      {
        userId: owner,
        mediaId: ids[1],
        action: 'watch',
        applied: false,
        occurredAt: new Date('2026-09-26T12:00:00Z'),
      },
      {
        userId: other,
        mediaId: ids[2],
        action: 'watch',
        occurredAt: new Date('2026-09-26T12:00:00Z'),
      },
    ]);
  await getDb()
    .insert(ratings)
    .values({
      userId: owner,
      mediaId: ids[0],
      value: 4,
      updatedAt: new Date('2026-09-27T12:00:00Z'),
    });
});
afterAll(async () => {
  if (!owner) return;
  await getDb()
    .delete(users)
    .where(inArray(users.id, [owner, other]));
  await getDb().delete(media).where(inArray(media.id, ids));
});
run(
  'profile is owner scoped, bounds rows and counts titles without duplicating rewatches',
  async () => {
    const overview = await profileData(owner);
    expect(overview.history).toHaveLength(0); // Activity is fetched when the row approaches the viewport.
    expect(overview.favourites).toHaveLength(20);
    expect(overview.totals).toEqual({
      movies: 63,
      episodes: 0,
      favourites: 63,
      rated: 1,
      unique: 63,
      watches: 63,
    });
    expect(overview.total).toBe(63);

    const next = await profileData(owner, { view: 'history', page: 2 });
    expect(next.history).toHaveLength(3);
    expect(next.pages).toBe(2);
    const favourites = await profileData(owner, { view: 'favourites', page: 99 });
    expect(favourites.page).toBe(2);
    expect(favourites.favourites).toHaveLength(3);
    const privateView = await profileData(other);
    expect(privateView.totals.favourites).toBe(0);
    expect(privateView.history).toHaveLength(0);
    expect((await profileData(other, { view: 'history' })).history).toHaveLength(1);
  }
);
run(
  'activity excludes pending imports and other accounts and ignores repeated no-op watch observations',
  async () => {
    const activity = await profileActivity(owner, new Date('2026-09-27T16:00:00Z'));
    expect(activity.days).toEqual([{ date: '2026-09-27', movies: 63, episodes: 0 }]);
  }
);

run(
  'rewatches remain individual events and date filters isolate the requested UTC period',
  async () => {
    const [event] = await getDb()
      .insert(trackingEvents)
      .values({
        userId: owner,
        mediaId: ids[0],
        action: 'watch',
        rewatch: true,
        occurredAt: new Date('2026-09-28T00:00:00Z'),
      })
      .returning();
    try {
      const view = await profileData(
        owner,
        {
          view: 'history',
          from: '2026-09-28',
          to: '2026-09-28',
        },
        new Date('2026-09-28T16:00:00Z')
      );
      expect(view.total).toBe(1);
      expect(view.history[0].rewatched).toBe(true);
      expect(view.totals.unique).toBe(63);
      expect(view.totals.watches).toBe(64);
      const activity = await profileActivity(owner, new Date('2026-09-28T16:00:00Z'));
      expect(activity.days.at(-1)).toEqual({ date: '2026-09-28', movies: 1, episodes: 0 });
      expect(activity.genres).toEqual([{ name: 'Drama', count: 63, filter: 'Drama' }]);
      expect(activity.ratings).toEqual([{ value: 4, count: 1 }]);
    } finally {
      await getDb().delete(trackingEvents).where(eq(trackingEvents.id, event.id));
    }
  }
);
run(
  'profile edits preserve other settings, backgrounds and owner-only favourite ordering',
  async () => {
    await getDb()
      .update(users)
      .set({ settings: { fullWidth: true } })
      .where(eq(users.id, owner));
    await updateProfile(owner, { action: 'background', mediaId: ids[0] });
    await updateProfile(owner, {
      action: 'edit',
      displayName: '  Cinema lover  ',
      bio: 'Stories',
      avatar: null,
    });
    await updateProfile(owner, { action: 'pin', mediaId: ids[1], value: true });
    await updateProfile(owner, { action: 'pin', mediaId: ids[2], value: true });
    await updateProfile(owner, { action: 'move', mediaId: ids[2], beforeId: ids[1] });
    const view = await profileData(owner);
    expect(view.profile.displayName).toBe('Cinema lover');
    expect(view.background?.id).toBe(ids[0]);
    expect(view.favourites.slice(0, 2).map((i) => i.id)).toEqual([ids[2], ids[1]]);
    const [saved] = await getDb().select().from(users).where(eq(users.id, owner));
    expect(saved.settings.fullWidth).toBe(true);
    expect((await profileData(other)).profile).toEqual({});
    await expect(
      updateProfile(other, { action: 'pin', mediaId: ids[1], value: true })
    ).rejects.toThrow();
    await expect(
      updateProfile(owner, {
        action: 'edit',
        displayName: 'x',
        bio: '',
        avatar: 'data:image/svg+xml;base64,PHN2Zz4=',
      })
    ).rejects.toThrow();
    await updateProfile(owner, { action: 'background', mediaId: null });
    expect((await profileData(owner)).background).toBeNull();
  }
);

run('GIF avatars preserve all frames, enforce visibility and remove replaced files', async () => {
  const input = {action:'edit',displayName:'Animated avatar',bio:'',avatar:'data:image/gif;base64,'+animatedAvatar};
  const saved = await updateProfile(owner,input);
  expect(saved.avatar).toMatch(new RegExp(`^/api/v1/profile/avatar/${owner}/[a-f0-9]{64}$`));
  const hash = saved.avatar!.split('/').at(-1)!;
  const response = await streamGifAvatar(owner,hash,owner);
  expect(response.headers.get('content-type')).toBe('image/gif');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(animatedAvatar,'base64'));
  await expect(streamGifAvatar(owner,hash,other)).rejects.toThrow('private');
  await expect(streamGifAvatar(owner,hash,null)).rejects.toThrow('private');
  await expect(updateProfile(other,{...input,avatar:saved.avatar})).rejects.toThrow();
  expect((await updateProfile(owner,{...input,avatar:saved.avatar,bio:'Still animated'})).avatar).toBe(saved.avatar);
  const tooLarge=Buffer.concat([Buffer.from(animatedAvatar,'base64'),Buffer.alloc(5*1024*1024)]);
  await expect(updateProfile(owner,{...input,avatar:'data:image/gif;base64,'+tooLarge.toString('base64')})).rejects.toThrow('5 MB');
  await expect(updateProfile(owner,{...input,avatar:'data:image/gif;base64,PHN2Zz4='})).rejects.toThrow('valid GIF');
  await updateProfile(owner,{...input,avatar:null});
  await expect(streamGifAvatar(owner,hash,owner)).rejects.toThrow('not found');
});

run('periods align history, totals, genres and ratings without changing favourites', async () => {
  const old = new Date('2000-01-01T12:00:00Z');
  const [event] = await getDb()
    .insert(trackingEvents)
    .values({ userId: owner, mediaId: ids[0], action: 'watch', occurredAt: old })
    .returning();
  try {
    const month = await profileData(owner, { period: 'month' });
    const all = await profileData(owner, { period: 'all' });
    expect(all.totals.watches).toBe(month.totals.watches + 1);
    expect(month.totals.favourites).toBe(all.totals.favourites);
    const filtered = await profileData(owner, { view: 'history', genre: 'Missing genre' });
    expect(filtered.total).toBe(0);
    const activity = await profileActivity(owner, new Date('2000-01-02T12:00:00Z'), 'month');
    expect(activity.days).toEqual([{ date: '2000-01-01', movies: 1, episodes: 0 }]);
    expect(activity.ratings).toHaveLength(0);
  } finally {
    await getDb().delete(trackingEvents).where(eq(trackingEvents.id, event.id));
  }
});
run('Other includes all remaining genres and opens matching history', async () => {
  await getDb()
    .update(media)
    .set({ genres: ['Drama', 'A', 'B', 'C', 'D', 'E', 'F', 'G'] })
    .where(eq(media.id, ids[0]));
  try {
    const activity = await profileActivity(owner, new Date('2026-09-28T12:00:00Z'));
    expect(activity.genres.at(-1)).toEqual({ name: 'Other', count: 2, filter: '__other__' });
    const view = await profileData(owner, { view: 'history', genre: '__other__' });
    expect(view.history.map((i) => i.id)).toEqual([ids[0]]);
  } finally {
    await getDb()
      .update(media)
      .set({ genres: ['Drama'] })
      .where(eq(media.id, ids[0]));
  }
});

run(
  'profile preferences, crop and feature persist independently and remain owner scoped',
  async () => {
    await updateProfile(owner, { action: 'preferences', period: 'month', favouriteKind: 'movie' });
    await updateProfile(owner, { action: 'position', value: 72 });
    await updateProfile(owner, { action: 'feature', mediaId: ids[0], note: 'A favourite story.' });
    const view = await profileData(owner);
    expect(view.profile.period).toBe('month');
    expect(view.profile.favouriteKind).toBe('movie');
    expect(view.profile.backgroundPosition).toBe(72);
    expect(view.featured?.id).toBe(ids[0]);
    await expect(
      updateProfile(other, { action: 'feature', mediaId: ids[0], note: '' })
    ).rejects.toThrow();
    await expect(updateProfile(owner, { action: 'position', value: 101 })).rejects.toThrow();
    await updateProfile(owner, { action: 'feature', mediaId: null, note: '' });
  }
);
run('activity search, type, repeats and rating drill-down filter the correct records', async () => {
  const view = await profileData(owner, { view: 'history', query: 'Profile 0' });
  expect(view.history.map((i) => i.id)).toEqual([ids[0]]);
  expect((await profileData(owner, { view: 'history', query: '%' })).total).toBe(0);
  expect((await profileData(owner, { view: 'history', activityKind: 'episode' })).total).toBe(0);
  expect((await profileData(owner, { view: 'history', repeats: true })).total).toBe(0);
  expect(
    (await profileData(owner, { view: 'ratings', rating: 4 })).ratedTitles.map((i) => i.id)
  ).toEqual([ids[0]]);
  expect((await profileData(other, { view: 'ratings', rating: 4 })).total).toBe(0);
});
run('unknown imported dates appear only in all-time history, never dated charts', async () => {
  const [item] = await getDb()
    .insert(media)
    .values({ kind: 'movie', title: 'Undated import' })
    .returning();
  ids.push(item.id);
  const { track } = await import('../src/lib/core/tracking/service');
  await track(owner, { mediaId: item.id, action: 'watch', source: 'jellyfin', acknowledged: true });
  const [state] = await getDb()
    .select()
    .from(trackingState)
    .where(eq(trackingState.mediaId, item.id));
  expect(state.watched).toBe(true);
  expect(state.lastWatchedAt).toBeNull();
  const all = await profileData(owner, { view: 'history', query: 'Undated import' });
  expect(all.total).toBe(1);
  expect(all.history[0].activity.completedAt).toBeNull();
  expect(all.history[0].dateKnown).toBe(false);
  expect((await profileData(owner, { period: 'month', query: 'Undated import' })).total).toBe(0);
  expect(
    (await profileData(owner, { from: '2026-09-27', to: '2026-09-27', query: 'Undated import' }))
      .total
  ).toBe(0);
});

run(
  'profile progress is owner scoped, bounded and gives dropped precedence over finished',
  async () => {
    await getDb()
      .insert(trackingState)
      .values([
        { userId: other, mediaId: ids[0], watched: true },
        { userId: other, mediaId: ids[1], watched: true, dropped: true },
        { userId: other, mediaId: ids[2], positionSeconds: 120 },
      ]);
    try {
      expect((await progressData(other, { view: 'finished' })).items.map((i) => i.id)).toEqual([
        ids[0],
      ]);
      expect((await progressData(other, { view: 'dropped' })).items.map((i) => i.id)).toEqual([
        ids[1],
      ]);
      expect((await progressData(other, { view: 'finished', kind: 'show' })).items).toEqual([]);
      expect((await progressData(other, { view: 'finished', scope: 'available' })).items).toEqual(
        []
      );
      expect((await profileProgress(other, 'watched')).items.map((i) => i.id)).toEqual([ids[0]]);
      expect((await profileProgress(other, 'dropped')).items.map((i) => i.id)).toEqual([ids[1]]);
      expect((await profileProgress(other, 'progress')).items.map((i) => i.id)).toEqual([ids[2]]);
      const firstPage = await profileProgress(owner, 'watched');
      expect(firstPage.items).toHaveLength(60);
      expect(firstPage.hasMore).toBe(true);
      const secondPage = await profileProgress(owner, 'watched', 2);
      expect(secondPage.items.length).toBeGreaterThan(0);
      expect(
        secondPage.items.every((item) => !firstPage.items.some((first) => first.id === item.id))
      ).toBe(true);
      expect((await profileProgress(owner, 'dropped')).items).toHaveLength(0);
      expect(profileProgress(other, 'invalid')).rejects.toThrow();
    } finally {
      await getDb().delete(trackingState).where(eq(trackingState.userId, other));
    }
  }
);

run('show status comes from regular episodes, not stale parent counters or flags', async () => {
  const showIds = Array.from({ length: 4 }, () => crypto.randomUUID());
  const episodeIds = Array.from({ length: 8 }, () => crypto.randomUUID());
  await getDb()
    .insert(media)
    .values([
      ...showIds.map((id) => ({ id, kind: 'show' as const, title: 'Progress show' })),
      ...episodeIds.map((id) => ({ id, kind: 'episode' as const, title: 'Progress episode' })),
    ]);
  try {
    await getDb()
      .insert(shows)
      .values(showIds.map((mediaId) => ({ mediaId })));
    await getDb()
      .insert(episodes)
      .values(
        episodeIds.map((mediaId, i) => ({
          mediaId,
          showId: showIds[Math.floor(i / 2)],
          seasonNumber: 1,
          episodeNumber: (i % 2) + 1,
        }))
      );
    await getDb()
      .insert(trackingState)
      .values([
        {
          userId: other,
          mediaId: showIds[0],
          watched: true,
          completedEpisodes: 99,
          totalEpisodes: 99,
        },
        { userId: other, mediaId: showIds[1], watched: false },
        { userId: other, mediaId: episodeIds[2], watched: true },
        { userId: other, mediaId: episodeIds[3], watched: true },
        { userId: other, mediaId: episodeIds[4], positionSeconds: 30, durationSeconds: 120 },
        { userId: other, mediaId: episodeIds[6], watched: true },
      ]);
    const finished = (await profileProgress(other, 'watched')).items;
    expect(finished.map((i) => i.id)).toEqual([showIds[1]]);
    const active = (await profileProgress(other, 'progress')).items;
    expect(active.map((i) => i.id).sort()).toEqual([showIds[2], showIds[3]].sort());
    expect(active.find((i) => i.id === showIds[2])?.trackingProgress).toEqual({
      unit: 'percent',
      value: 12.5,
    });
    expect(active.find((i) => i.id === showIds[3])?.completedEpisodes).toBe(1);
    await updateProfile(other, { action: 'preferences', period: 'month' });
    await updateProfile(other, { action: 'preferences', favouriteKind: 'show' });
    const settings = (await profileData(other)).profile;
    expect(settings.period).toBe('month');
    expect(settings.favouriteKind).toBe('show');
  } finally {
    await getDb()
      .delete(media)
      .where(inArray(media.id, [...episodeIds, ...showIds]));
  }
});

run(
  'Dropped includes explicitly dropped seasons and episodes with independent restore targets',
  async () => {
    const [showId, seasonId, episodeId, movieId] = Array.from({ length: 4 }, () =>
      crypto.randomUUID()
    );
    const fixtureIds = [showId, seasonId, episodeId, movieId];
    await getDb()
      .insert(media)
      .values([
        { id: showId, kind: 'show', title: 'Dropped series' },
        { id: seasonId, kind: 'season', title: 'A named season' },
        { id: episodeId, kind: 'episode', title: 'A named episode' },
        { id: movieId, kind: 'movie', title: 'Dropped movie' },
      ]);
    try {
      await getDb().insert(shows).values({ mediaId: showId });
      await getDb().insert(seasons).values({ mediaId: seasonId, showId, seasonNumber: 2 });
      await getDb()
        .insert(episodes)
        .values({ mediaId: episodeId, showId, seasonId, seasonNumber: 2, episodeNumber: 3 });
      for (const mediaId of [seasonId, episodeId, movieId])
        await track(other, { mediaId, action: 'drop' });
      const result = await progressData(other, { view: 'dropped' });
      expect(result.items.map((i) => i.id).sort()).toEqual([seasonId, episodeId, movieId].sort());
      expect(result.total).toBe(3);
      const episode = result.items.find((i) => i.id === episodeId)!;
      expect(episode.captionTitle).toBe('Dropped series');
      expect(episode.captionSubtitle).toBe('S02E03 · A named episode');
      expect(episode.trackingParents?.map((p) => [p.id, p.dropped])).toEqual([
        [seasonId, true],
        [showId, false],
      ]);
      expect(
        (await progressData(other, { view: 'dropped', kind: 'show' })).items.map((i) => i.id).sort()
      ).toEqual([seasonId, episodeId].sort());
      expect(
        (await progressData(other, { view: 'dropped', kind: 'movie' })).items.map((i) => i.id)
      ).toEqual([movieId]);
      await track(other, { mediaId: showId, action: 'drop' });
      await track(other, { mediaId: seasonId, action: 'restore' });
      const restored = await progressData(other, { view: 'dropped', kind: 'show' });
      expect(restored.items.map((i) => i.id).sort()).toEqual([showId, episodeId].sort());
      expect(
        restored.items.find((i) => i.id === episodeId)?.trackingParents?.map((p) => p.dropped)
      ).toEqual([false, true]);
      expect((await progressData(owner, { view: 'dropped' })).items).toHaveLength(0);
    } finally {
      await getDb().delete(media).where(inArray(media.id, fixtureIds));
    }
  }
);

run(
  'dated show and collection rewatches retain history and drive episode and movie continuations',
  async () => {
    const [showId, season1, season2, ep1, ep2, collection, movie1, movie2] = Array.from(
      { length: 8 },
      () => crypto.randomUUID()
    );
    const fixtures = [showId, season1, season2, ep1, ep2, collection, movie1, movie2];
    await getDb()
      .insert(media)
      .values([
        { id: showId, kind: 'show', title: 'Rewatch show' },
        ...[season1, season2].map((id) => ({ id, kind: 'season' as const, title: 'Named season' })),
        ...[ep1, ep2].map((id) => ({ id, kind: 'episode' as const, title: 'Rewatch episode' })),
        { id: collection, kind: 'collection', title: 'Rewatch collection' },
        ...[movie1, movie2].map((id) => ({ id, kind: 'movie' as const, title: 'Rewatch movie' })),
      ]);
    try {
      await getDb().insert(shows).values({ mediaId: showId });
      await getDb()
        .insert(seasons)
        .values([season1, season2].map((mediaId, i) => ({ mediaId, showId, seasonNumber: i + 1 })));
      await getDb()
        .insert(episodes)
        .values(
          [ep1, ep2].map((mediaId, i) => ({
            mediaId,
            showId,
            seasonId: [season1, season2][i],
            seasonNumber: i + 1,
            episodeNumber: 1,
          }))
        );
      await getDb()
        .insert(mediaRelationships)
        .values(
          [movie1, movie2].map((childId, position) => ({
            parentId: collection,
            childId,
            kind: 'collection' as const,
            position,
          }))
        );
      for (const mediaId of [ep1, ep2, movie1, movie2]) {
        await track(other, {
          mediaId,
          action: 'watch',
          durationSeconds: 100,
          occurredAt: '2020-01-01T00:00:00.000Z',
          acknowledged: true,
        });
      }
      const baseline = await getDb()
        .select()
        .from(trackingEvents)
        .where(eq(trackingEvents.userId, other));
      for (const mediaId of [showId, collection])
        await setRewatch(other, { mediaId, startedAt: '2025-01-01T00:00:00.000Z' });
      expect(
        (await getDb().select().from(trackingEvents).where(eq(trackingEvents.userId, other))).length
      ).toBe(baseline.length);
      const first = await progressData(other, { view: 'watching' });
      expect(first.items.map((i) => i.id)).toEqual([ep1]);
      expect(first.items[0].watched).toBe(false);
      expect(first.items[0].progress).toBe(0);
      expect((await progressData(other, { view: 'up-next' })).items.map((i) => i.id)).toEqual([
        movie1,
      ]);
      expect((await profileProgress(other, 'watched')).items.some((i) => i.id === showId)).toBe(
        false
      );
      const views = await mediaViewsForIds(other, [showId, collection]);
      expect(views.every((i) => !i.watched && i.rewatchStartedAt)).toBe(true);
      expect(views.find((i) => i.id === showId)?.completedEpisodes).toBe(0);
      const completed = await track(other, { mediaId: ep1, action: 'watch', acknowledged: true });
      expect(completed.state.playCount).toBe(2);
      expect(completed.changed).toBe(true);
      expect(
        (await track(other, { mediaId: ep1, action: 'watch', acknowledged: true })).changed
      ).toBe(false);
      expect((await progressData(other, { view: 'up-next' })).items.map((i) => i.id)).toContain(
        season2
      );
      await track(other, {
        mediaId: movie1,
        action: 'watch',
        acknowledged: true,
        sequence: (await progressData(other, { view: 'up-next' })).items.find(
          (item) => item.id === movie1
        )!.sequence,
      });
      expect((await progressData(other, { view: 'up-next' })).items.map((i) => i.id)).toContain(
        movie2
      );
      const repeatEvents = await getDb()
        .select()
        .from(trackingEvents)
        .where(eq(trackingEvents.userId, other));
      expect(repeatEvents.filter((e) => e.rewatch)).toHaveLength(2);
      expect((await mediaViewsForIds(owner, [showId]))[0].rewatchStartedAt).toBeNull();
      for (const mediaId of [showId, collection])
        await setRewatch(other, { mediaId, startedAt: null });
      expect(
        (await mediaViewsForIds(other, [showId, collection])).every(
          (i) => i.watched && !i.rewatchStartedAt
        )
      ).toBe(true);
      expect(
        (await getDb().select().from(trackingEvents).where(eq(trackingEvents.userId, other))).length
      ).toBe(repeatEvents.length);
      await expect(
        setRewatch(other, { mediaId: showId, startedAt: '2999-01-01T00:00:00.000Z' })
      ).rejects.toThrow();
      await setRewatch(other, { mediaId: movie1, startedAt: new Date().toISOString() });
      expect(
        (await progressData(other, { view: 'watching' })).items.map((item) => item.id)
      ).toContain(movie1);
      await setRewatch(other, { mediaId: movie1, startedAt: null });
    } finally {
      await getDb().delete(media).where(inArray(media.id, fixtures));
    }
  }
);
