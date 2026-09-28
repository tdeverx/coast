import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import {
  emptyTrackingState,
  episodeOrderWarning,
  isUnstartedWatchlist,
  projectTracking,
  trackingFilter,
} from '../src/lib/core/tracking/state';
import { ratingValueSchema } from '../src/lib/core/ratings/service';
import { isExactPermutation } from '../src/lib/core/lists/service';
import { resolveMetadata } from '../src/lib/catalogue/metadata/resolve';
import {
  metadataOverrideInputSchema,
  presentationInputSchema,
} from '../src/lib/catalogue/overrides/service';

describe('canonical tracking rules', () => {
  test('a no-op cannot undrop, including a duration-only refresh', () => {
    const previous = { ...emptyTrackingState(), dropped: true, positionSeconds: 300 };
    const same = projectTracking(previous, { action: 'progress', positionSeconds: 300 });
    expect(same.changed).toBe(false);
    expect(same.state.dropped).toBe(true);
    const duration = projectTracking(previous, {
      action: 'progress',
      positionSeconds: 300,
      durationSeconds: 2000,
    });
    expect(duration.state.dropped).toBe(true);
    expect(duration.progressChanged).toBe(false);
  });
  test('genuine progress or a manual restore undrops', () => {
    const previous = { ...emptyTrackingState(), dropped: true, positionSeconds: 300 };
    expect(
      projectTracking(previous, { action: 'progress', positionSeconds: 301 }).state.dropped
    ).toBe(false);
    expect(projectTracking(previous, { action: 'restore' }).state.dropped).toBe(false);
    expect(projectTracking(previous, { action: 'favourite', value: true }).state.dropped).toBe(
      true
    );
  });
  test('completion is idempotent, explicit rewatches count, unwatch keeps historical plays', () => {
    const watched = projectTracking(emptyTrackingState(), {
      action: 'watch',
      durationSeconds: 3600,
    }).state;
    expect(watched.playCount).toBe(1);
    expect(watched.positionSeconds).toBe(3600);
    expect(projectTracking(watched, { action: 'watch' }).changed).toBe(false);
    const rewatched = projectTracking(watched, { action: 'watch', rewatch: true }).state;
    expect(rewatched.playCount).toBe(2);
    const unwatched = projectTracking(rewatched, { action: 'unwatch' }).state;
    expect(unwatched.playCount).toBe(2);
    expect(unwatched.watched).toBe(false);
    expect(unwatched.lastWatchedAt).toEqual(rewatched.lastWatchedAt);
  });
  test('saved intent survives while the ordinary watchlist changes after meaningful progress', () => {
    const saved = { ...emptyTrackingState(), watchlist: true };
    const partial = projectTracking(saved, { action: 'progress', positionSeconds: 120 }).state;
    expect(isUnstartedWatchlist(partial, 'movie')).toBe(true);
    expect(trackingFilter(partial)).toBe('in-progress');
    const watched = projectTracking(partial, { action: 'watch' }).state;
    expect(watched.watchlist).toBe(true);
    expect(isUnstartedWatchlist(watched, 'movie')).toBe(false);
    expect(isUnstartedWatchlist({ ...saved, completedEpisodes: 1 }, 'show')).toBe(false);
    expect(trackingFilter({ ...watched, dropped: true })).toBe('dropped');
  });
  test('suspicious episode sequences flag gaps and backwards clearing, excluding specials', () => {
    const episodes = [
      { mediaId: 'special', seasonNumber: 0, episodeNumber: 1, isSpecial: true, watched: false },
      { mediaId: 'one', seasonNumber: 1, episodeNumber: 1, isSpecial: false, watched: false },
      { mediaId: 'two', seasonNumber: 1, episodeNumber: 2, isSpecial: false, watched: false },
    ];
    expect(episodeOrderWarning(episodes, 'one', 'watch')).toBeNull();
    expect(episodeOrderWarning(episodes, 'two', 'watch')).toContain('Earlier episodes');
    expect(
      episodeOrderWarning(
        episodes.map((e) => ({ ...e, watched: true })),
        'one',
        'unwatch'
      )
    ).toContain('Later episodes');
    expect(episodeOrderWarning(episodes, 'special', 'watch')).toBeNull();
  });
});

describe('ratings and ordered lists', () => {
  test('only half-star values and rating removal are accepted', () => {
    for (const value of [null, 0.5, 1, 2.5, 5])
      expect(v.safeParse(ratingValueSchema, value).success).toBe(true);
    for (const value of [0, 0.1, 2.75, 5.5, Infinity, NaN, '3'])
      expect(v.safeParse(ratingValueSchema, value).success).toBe(false);
  });
  test('reordering requires every existing item exactly once', () => {
    expect(isExactPermutation(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(isExactPermutation(['a', 'b'], ['a', 'a'])).toBe(false);
    expect(isExactPermutation(['a', 'b'], ['a'])).toBe(false);
    expect(isExactPermutation(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

describe('metadata provenance and policy', () => {
  const snapshots = [
    {
      provider: 'tmdb',
      title: 'TMDB title',
      originalTitle: 'Original title',
      posterPath: '/global.jpg',
      overview: 'Global synopsis',
      certificate: '15',
      region: 'GB',
      updatedAt: '2026-01-03T00:00:00Z',
    },
    {
      provider: 'jellyfin',
      title: 'Local title',
      posterPath: '/local.jpg',
      updatedAt: '2026-01-02T00:00:00Z',
    },
  ];
  test('user, admin, local snapshot and fallback are field-specific and immutable', () => {
    const before = JSON.stringify(snapshots);
    const resolved = resolveMetadata({
      fallback: { title: 'Fallback', runtimeMinutes: 90 },
      snapshots,
      override: { title: 'Admin title' },
      user: { posterPath: '/mine.jpg' },
    });
    expect(resolved.values).toMatchObject({
      title: 'Admin title',
      posterPath: '/mine.jpg',
      overview: 'Global synopsis',
      runtimeMinutes: 90,
    });
    expect(resolved.provenance.title?.source).toBe('administrator');
    expect(resolved.provenance.posterPath?.source).toBe('user');
    expect(JSON.stringify(snapshots)).toBe(before);
  });
  test('locked fields skip user preferences, including original-title presentation', () => {
    const resolved = resolveMetadata({
      fallback: {},
      snapshots,
      override: { title: 'Fixed title' },
      locks: ['title', 'posterPath'],
      user: { title: 'My title', posterPath: '/mine.jpg' },
      preferOriginalTitle: true,
    });
    expect(resolved.values.title).toBe('Fixed title');
    expect(resolved.values.posterPath).toBe('/local.jpg');
  });
  test('TMDB-only excludes all local provider fields and certificates follow region', () => {
    const resolved = resolveMetadata({
      fallback: {},
      snapshots,
      policy: 'tmdb-only',
      region: 'US',
    });
    expect(resolved.values.title).toBe('TMDB title');
    expect(resolved.values.posterPath).toBe('/global.jpg');
    expect(resolved.values.certificate).toBeUndefined();
    expect(resolveMetadata({ fallback: {}, snapshots }).values.title).toBe('Local title');
  });
  test('original titles are a user presentation preference', () => {
    expect(
      resolveMetadata({ fallback: {}, snapshots, preferOriginalTitle: true }).values.title
    ).toBe('Original title');
  });
  test('metadata boundaries reject script artwork, malformed dates and unknown lock fields', () => {
    expect(
      v.safeParse(presentationInputSchema, { posterPath: 'javascript:alert(1)' }).success
    ).toBe(false);
    expect(
      v.safeParse(presentationInputSchema, {
        posterPath: 'https://user:password@example.com/art.jpg',
      }).success
    ).toBe(false);
    expect(
      v.safeParse(presentationInputSchema, { posterPath: 'https://example.com/art.jpg' }).success
    ).toBe(true);
    expect(
      v.safeParse(metadataOverrideInputSchema, {
        values: { releaseDate: 'next Tuesday' },
        locks: [],
      }).success
    ).toBe(false);
    expect(
      v.safeParse(metadataOverrideInputSchema, { values: {}, locks: ['credentials'] }).success
    ).toBe(false);
  });
});
