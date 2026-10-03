import { describe, test, expect, spyOn } from 'bun:test';
import { TmdbAdapter } from '../src/lib/providers/tmdb/adapter.server';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { providerCache } from '../src/lib/server/utils/provider-cache';
describe('rich details', () => {
  test('season shells keep provider titles and artwork without fetching episode guides', async () => {
    const paths: string[] = [];
    const adapter = new TmdbAdapter(async (path) => {
      paths.push(path);
      return {
        id: 1,
        name: 'Show',
        seasons: [
          {
            id: 2,
            season_number: 1,
            name: 'A named season',
            poster_path: '/season.jpg',
            overview: 'Season story',
          },
        ],
      };
    });
    const show = await adapter.details('show', '1');
    expect(paths).toHaveLength(1);
    expect(show.children?.[0]).toMatchObject({
      externalId: '1:season:1',
      title: 'A named season',
      posterPath: 'https://image.tmdb.org/t/p/w780/season.jpg',
    });
  });
  test('episode details retain stable identity, still and specific cast', async () => {
    const adapter = new TmdbAdapter(async (path) => {
      expect(path).toContain('/tv/1/season/2/episode/3');
      return {
        id: 22,
        name: 'An episode',
        still_path: '/still.jpg',
        credits: { cast: [], guest_stars: [{ id: 5, name: 'Guest', character: 'Detective' }] },
      };
    });
    const episode = await adapter.episode('1', 2, 3);
    expect(episode).toMatchObject({
      externalId: '22',
      kind: 'episode',
      seasonNumber: 2,
      episodeNumber: 3,
      cast: [{ id: 5, name: 'Guest', character: 'Detective' }],
    });
    expect(episode.artwork?.thumb).toEndWith('/still.jpg');
  });
  test('ratings retain vote counts and reviews use generated safe source links', async () => {
    const adapter = new TmdbAdapter(async (path) =>
      path.includes('/reviews?')
        ? {
            total_pages: 2,
            results: [
              {
                id: 'safe',
                author: 'Viewer',
                content: '<script>text only</script>',
                author_details: { rating: 8 },
              },
            ],
          }
        : {
            vote_average: 8.2,
            vote_count: 42,
            budget: 1000,
            credits: {
              crew: [
                { id: 8, name: 'Director', job: 'Director' },
                { id: 8, name: 'Director', job: 'Writer' },
              ],
            },
          }
    );
    const result = await adapter.insights('movie/1');
    expect(result.rating).toBe(8.2);
    expect(result.votes).toBe(42);
    expect(result.crew).toHaveLength(1);
    expect(result.crew[0].character).toBe('Director · Writer');
    expect(result.reviews[0]).toMatchObject({
      spoiler: true,
      url: 'https://www.themoviedb.org/review/safe',
      text: '<script>text only</script>',
    });
    expect(result.pages).toBe(2);
  });
  test('season details never request unsupported reviews', async () => {
    const paths: string[] = [];
    const adapter = new TmdbAdapter(async (path) => {
      paths.push(path);
      return { vote_average: 0, vote_count: 0 };
    });
    const result = await adapter.insights('tv/1/season/2');
    expect(paths).toHaveLength(1);
    expect(result.rating).toBeUndefined();
    expect(result.reviews).toEqual([]);
  });
  test('person credits retain acting and crew roles and exclude unknown kinds', async () => {
    const adapter = new TmdbAdapter(async () => ({
      id: 9,
      name: 'Person',
      combined_credits: {
        cast: [
          { id: 1, media_type: 'movie', title: 'Movie', character: 'Lead' },
          { id: 2, media_type: 'person', name: 'Ignore' },
        ],
        crew: [
          { id: 1, media_type: 'movie', title: 'Movie', job: 'Producer', department: 'Production' },
        ],
      },
    }));
    const result = await adapter.person(9);
    expect(result.credits.map((c) => c.creditDepartment)).toEqual(['Acting', 'Production']);
    expect(result.credits.map((c) => [c.department, c.role])).toEqual([
      ['acting', 'Lead'],
      ['crew', 'Producer'],
    ]);
    expect(result.biography).toBe('');
  });
  test('Trakt community keeps source rating and explicit spoiler flags', async () => {
    const adapter = new TraktAdapter(
      async (path) =>
        path.includes('/ratings')
          ? { rating: 7.8, votes: 20, distribution: { 1: 2, 8: 10, 10: 8 } }
          : path.includes('/stats')
            ? { watchers: 12, plays: 15, comments: 0, lists: 3 }
            : [
                {
                  id: 1,
                  comment: 'Review',
                  spoiler: true,
                  created_at: '2026-09-01T00:00:00Z',
                  user_rating: 8,
                  user: { username: 'viewer' },
                },
              ],
      'key',
      'secret'
    );
    const result = await adapter.community('/shows/1/seasons/2');
    expect(result.source).toBe('Trakt');
    expect(result.rating).toBe(7.8);
    expect(result.metrics).toContainEqual({ label: 'Viewers', value: 12 });
    expect(result.metrics).toContainEqual({ label: 'Comments', value: 0 });
    expect(result.ratingDistribution).toHaveLength(10);
    expect(result.ratingDistribution?.reduce((sum, r) => sum + r.count, 0)).toBe(20);
    expect(result.ratingDistribution?.find((r) => r.value === 2)?.count).toBe(0);
    expect(result.reviews[0].spoiler).toBe(true);
  });
  test('cache coalesces requests and permits retry after failures', async () => {
    const cache = providerCache<number>(2);
    let calls = 0;
    const fetch = async () => ++calls;
    expect(await Promise.all([cache('a', fetch), cache('a', fetch)])).toEqual([1, 1]);
    await expect(
      cache('b', async () => {
        throw new Error('offline');
      })
    ).rejects.toThrow('offline');
    expect(await cache('b', fetch)).toBe(2);
    expect(await cache('a', fetch)).toBe(1);
  });
  test('expired provider facts never survive an outage or an incomplete replacement', async () => {
    let now = 100;
    const clock = spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const cache = providerCache<{ value: number; incomplete?: boolean }>(2, 10, value => !value.incomplete);
      expect(await cache('title', async () => ({ value: 1 }))).toEqual({ value: 1 });
      now = 110;
      await expect(cache('title', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
      expect(await cache('title', async () => ({ value: 2, incomplete: true }))).toEqual({ value: 2, incomplete: true });
      expect(await cache('title', async () => ({ value: 3 }))).toEqual({ value: 3 });
      expect(await cache('title', async () => { throw new Error('should be cached'); })).toEqual({ value: 3 });
    } finally {
      clock.mockRestore();
    }
  });
});

test('a reviews outage preserves TMDB facts and marks the result retryable', async () => {
  const adapter = new TmdbAdapter(async (path) => {
    if (path.includes('/reviews?')) throw new Error('offline');
    return { vote_average: 8, vote_count: 10, status: 'Released' };
  });
  const data = await adapter.insights('movie/1');
  expect(data.rating).toBe(8);
  expect(data.incomplete).toBe(true);
  expect(data.facts).toContainEqual({ label: 'Status', value: 'Released' });
});
test('partial Trakt failure preserves available ratings', async () => {
  const adapter = new TraktAdapter(
    async (path) => {
      if (path.includes('/ratings')) return { rating: 8, votes: 10 };
      throw new Error('offline');
    },
    'key',
    'secret'
  );
  const data = await adapter.community('/movies/1');
  expect(data.rating).toBe(8);
  expect(data.incomplete).toBe(true);
});

test('public Trakt community reads use app credentials without a personal token or writes', async () => {
  const requests: string[] = [];
  const adapter = new TraktAdapter(
    async (path, init) => {
      requests.push(path);
      expect(init?.method ?? 'GET').toBe('GET');
      expect(new Headers(init?.headers).get('Authorization')).toBeNull();
      expect(new Headers(init?.headers).get('trakt-api-key')).toBe('public-client');
      if (path.endsWith('/ratings')) return { rating: 8, votes: 4 };
      if (path.endsWith('/stats')) return { watchers: 3, plays: 5 };
      return [];
    },
    'public-client',
    'unused-secret'
  );
  const result = await adapter.community('/movies/1');
  expect(result.ratingDistribution).toBeUndefined();
  expect(result.metrics?.map((m) => m.label)).toEqual(['Viewers', 'Plays']);
  expect(requests).toHaveLength(3);
});
