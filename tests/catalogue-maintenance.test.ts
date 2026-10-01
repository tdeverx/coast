import { test, expect } from 'bun:test';
import {
  scanTraktCatalogue,
  scanJellyfinCatalogue,
} from '../src/lib/catalogue/maintenance.server';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { JellyfinAdapter } from '../src/lib/providers/jellyfin/adapter.server';

test('user catalogue scans all direct Trakt categories and pages, never recommendations or writes', async () => {
  const paths: string[] = [],
    saved: string[] = [];
  const movie = (id: number) => ({
    movie: { title: 'Direct title', ids: { trakt: id, tmdb: id } },
  });
  const adapter = new TraktAdapter(
    async (path, init) => {
      expect(init?.method ?? 'GET').toBe('GET');
      paths.push(path);
      if (path.includes('/sync/history'))
        return path.includes('page=1&')
          ? Array.from({ length: 100 }, (_, i) => movie(i + 1))
          : [movie(101)];
      if (path.includes('/sync/collection/shows'))
        return [
          {
            show: { title: 'Direct show', ids: { trakt: 202, tmdb: 202 } },
            seasons: [],
          },
        ];
      if (path.includes('/users/me/lists/9/items')) return [movie(303)];
      if (path.includes('/users/me/lists'))
        return [{ name: 'Direct list', ids: { trakt: 9, slug: 'direct' } }];
      return [];
    },
    'client',
    'secret',
    'token'
  );
  await scanTraktCatalogue(adapter, async (kind, id) => {
    saved.push(`${kind}:${id}`);
    return true;
  });
  expect(saved).toContain('movie:101');
  expect(saved).toContain('show:202');
  expect(saved).toContain('movie:303');
  for (const category of [
    'history',
    'playback',
    'collection/movies',
    'ratings',
    'watchlist',
  ])
    expect(paths.some((p) => p.includes(`/sync/${category}?`))).toBe(true);
  expect(paths.some((p) => /recommendations|trending/.test(p))).toBe(false);
});

test('Jellyfin discovery only uses meaningful personal activity and follows episode parent identity', async () => {
  const saved: string[] = [],
    itemReads: string[] = [];
  const item = (id: string, extra: Record<string, unknown> = {}) => ({
    Id: id,
    Name: id,
    Type: 'Movie',
    ...extra,
  });
  const adapter = new JellyfinAdapter(
    async (path) => {
      if (path.startsWith('/Items?'))
        return {
          TotalRecordCount: 3,
          Items: [
            item('server-only'),
            item('watched', { UserData: { Played: true } }),
            item('episode', {
              Type: 'Episode',
              SeriesId: 'parent',
              UserData: { PlaybackPositionTicks: 10000000 },
            }),
          ],
        };
      itemReads.push(path);
      return item(path.endsWith('/parent') ? 'parent' : 'watched', {
        Type: path.endsWith('/parent') ? 'Series' : 'Movie',
        ProviderIds: { Tmdb: path.endsWith('/parent') ? '2' : '1' },
      });
    },
    'coast-user',
    'token'
  );
  await scanJellyfinCatalogue(adapter, 'remote-user', async (kind, id) => {
    saved.push(`${kind}:${id}`);
    return true;
  });
  expect(saved).toEqual(['movie:1', 'show:2']);
  expect(itemReads.some((p) => p.includes('server-only'))).toBe(false);
});

test('background metadata refresh omits recommendation fetching without changing normal detail reads', async () => {
  const { TmdbAdapter } =
    await import('../src/lib/providers/tmdb/adapter.server');
  const paths: string[] = [];
  const adapter = new TmdbAdapter(async (path) => {
    paths.push(path);
    return { id: 1, title: 'Direct title' };
  });
  await adapter.details('movie', '1', false);
  await adapter.details('movie', '1');
  expect(
    new URL(paths[0], 'https://fixture.invalid').searchParams.get(
      'append_to_response'
    )
  ).not.toContain('recommendations');
  expect(
    new URL(paths[1], 'https://fixture.invalid').searchParams.get(
      'append_to_response'
    )
  ).toContain('recommendations');
});
