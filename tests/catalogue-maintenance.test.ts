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

test('Jellyfin catalogue unions activity filters and hydrates only unresolved roots in authenticated batches', async () => {
  const saved: string[] = [], filters: string[] = [], batches: string[][] = [], resolved: string[][] = [];
  const adapter = new JellyfinAdapter(async (path) => {
    const url = new URL(path, 'https://fixture.invalid');
    expect(url.pathname).toBe('/Items');
    expect(url.searchParams.get('userId')).toBe('remote');
    const ids = url.searchParams.get('ids');
    if (ids) {
      batches.push(ids.split(','));
      expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(100);
      // The server omits an inaccessible individual root without failing the page.
      return { Items: ids.split(',').filter(id => id !== 'missing').map(id => ({
        Id: id, Type: id === 'new-show' ? 'Series' : 'Movie', Name: id,
        ProviderIds: { Tmdb: id === 'new-show' ? '42' : '43' },
      })), TotalRecordCount: ids.split(',').filter(id => id !== 'missing').length };
    }
    const filter = url.searchParams.get('filters')!;
    filters.push(filter);
    const items = filter === 'IsPlayed' ? [
      { Id: 'known', Type: 'Movie', Name: 'Known', UserData: { Played: true } },
      { Id: 'episode-one', Type: 'Episode', Name: 'One', SeriesId: 'new-show', UserData: { Played: true } },
      { Id: 'episode-two', Type: 'Episode', Name: 'Two', SeriesId: 'new-show', UserData: { Played: true } },
      { Id: 'missing', Type: 'Movie', Name: 'Missing', UserData: { Played: true } },
    ] : filter === 'IsResumable' ? [
      { Id: 'episode-resume', Type: 'Episode', Name: 'Resume', SeriesId: 'new-show', UserData: { PlaybackPositionTicks: 10000000 } },
    ] : [ { Id: 'favourite', Type: 'Movie', Name: 'Favourite', UserData: { IsFavorite: true } } ];
    return { Items: items, TotalRecordCount: items.length };
  }, 'client', 'token');
  await scanJellyfinCatalogue(adapter, 'remote', async (kind, id) => {
    saved.push(`${kind}:${id}`); return true;
  }, async (ids) => { resolved.push(ids); return new Set(['known']); });
  expect(filters).toEqual(['IsPlayed', 'IsResumable', 'IsFavorite']);
  expect(resolved).toEqual([['known', 'new-show', 'missing'], ['favourite']]);
  expect(batches).toEqual([['new-show', 'missing'], ['favourite']]);
  expect(saved).toEqual(['show:42', 'movie:43']);
});

test('Jellyfin cursor resumes after committed references and a failed page cannot advance', async () => {
  const reads: string[] = [], saved: string[] = [];
  const adapter = new JellyfinAdapter(async (path) => {
    const url = new URL(path, 'https://fixture.invalid');
    if (url.searchParams.has('ids')) return { Items: [{ Id: url.searchParams.get('ids')!, Type: 'Movie', Name: 'Resume', ProviderIds: { Tmdb: '91' } }], TotalRecordCount: 1 };
    const filter = url.searchParams.get('filters')!; reads.push(filter);
    return { Items: [{ Id: filter === 'IsPlayed' ? 'played' : 'resume', Type: 'Movie', Name: 'Item', UserData: { Played: true } }], TotalRecordCount: 1 };
  }, 'client', 'token');
  let checkpoint: NonNullable<Parameters<typeof scanJellyfinCatalogue>[4]>['cursor'];
  // Save failure leaves the source page as the next work unit.
  let callbacks = 0;
  await expect(scanJellyfinCatalogue(adapter, 'remote', async () => { throw new Error('save failed'); }, undefined, {
    committed: async () => { callbacks++; },
  })).rejects.toThrow();
  expect(callbacks).toBe(0);
  const stop = new Error('yield');
  await expect(scanJellyfinCatalogue(adapter, 'remote', async (_kind, id) => { saved.push(id); return true; }, undefined, {
    cursor: { filter: 1, offset: 0 }, committed: async cursor => { checkpoint = cursor; throw stop; },
  })).rejects.toThrow('yield');
  expect(saved).toEqual(['91']); expect(checkpoint).toEqual({ filter: 2, offset: 0 });
  await scanJellyfinCatalogue(adapter, 'remote', async (_kind, id) => { saved.push(id); return true; }, undefined, { cursor: checkpoint });
  expect(reads.slice(-2)).toEqual(['IsResumable', 'IsFavorite']);
});

test('Trakt cursor resumes inside a bounded list page without repeating earlier categories or lists', async () => {
  const paths: string[] = [], saved: string[] = [];
  const movie = (id: number) => ({ movie: { title: 'List title', ids: { trakt: id, tmdb: id } } });
  const adapter = new TraktAdapter(async path => {
    paths.push(path);
    if (path.includes('/lists/9/items')) return path.includes('page=1&')
      ? Array.from({ length: 100 }, (_, i) => movie(i + 1)) : [movie(101)];
    if (path.includes('/lists/10/items')) return [movie(102)];
    if (path.includes('/users/me/lists')) return [
      { name: 'First', ids: { trakt: 9, slug: 'first' } }, { name: 'Second', ids: { trakt: 10, slug: 'second' } },
    ];
    return [];
  }, 'client', 'secret', 'token');
  let checkpoint: NonNullable<Parameters<typeof scanTraktCatalogue>[2]>['cursor'];
  const save = async (_kind: unknown, id: string) => { saved.push(id); return true; };
  await expect(scanTraktCatalogue(adapter, save, {
    committed: async cursor => {
      if (cursor.stage === 6 && cursor.itemsPage === 2) {
        expect(saved).toHaveLength(100); checkpoint = cursor; throw new Error('yield');
      }
    },
  })).rejects.toThrow('yield');
  expect(checkpoint?.listIds).toEqual(['9', '10']);
  const before = paths.length;
  await scanTraktCatalogue(adapter, save, { cursor: checkpoint });
  expect(paths.slice(before)).toHaveLength(2);
  expect(paths[before]).toContain('/lists/9/items/'); expect(paths[before]).toContain('page=2&');
  expect(saved.slice(-2)).toEqual(['101', '102']);
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
