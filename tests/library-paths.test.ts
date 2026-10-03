import { describe, expect, test } from 'bun:test';
import { libraryBrowseDefaults, libraryBrowsePaths } from '../src/lib/library';

const base = { surface: 'watch' as const, collection: false, selection: 'all', kind: 'all', scope: 'available', genre: '', relationship: 'all', source: 'all', availability: 'all', username: '', page: 1 };
const url = (path: string) => new URL(path, 'http://coast/');
describe('Library browsing paths', () => {
  test('Library defaults to Collection with availability off and respects explicit filters', () => {
    expect(libraryBrowseDefaults(new URLSearchParams())).toEqual({ collection: true, scope: 'all' });
    expect(libraryBrowseDefaults(new URLSearchParams('collection=false&scope=available'))).toEqual({ collection: false, scope: 'available' });
    expect(libraryBrowseDefaults(new URLSearchParams('availability=available'))).toEqual({ collection: true, scope: 'available' });
    expect(libraryBrowseDefaults(new URLSearchParams('collection=false'), true).collection).toBe(true);
  });
  test('Collection and availability remain independent filters on the shared route', () => {
    const paths = libraryBrowsePaths({ ...base, collection: true, scope: 'all', availability: 'unknown', relationship: 'watchlist', username: 'friend', selection: 'progress', page: 3 });
    const page = url(paths.href), api = url(paths.api);
    expect(page.pathname).toBe('/library');
    expect(page.searchParams.get('collection')).toBe('true');
    expect(api.pathname).toBe('/collection');
    expect(api.searchParams.get('availability')).toBe('unknown');
    expect(api.searchParams.get('activity')).toBe('active');
    expect(api.searchParams.get('relationship')).toBe('watchlist');
    expect(api.searchParams.get('username')).toBe('friend');
    expect(api.searchParams.get('level')).toBe('root');
    expect(api.searchParams.get('page')).toBe('3');
  });
  test('all media library rows expand through Library', () => {
    for (const surface of ['watch', 'listen', 'play'] as const) {
      const paths = libraryBrowsePaths({ ...base, surface, selection: surface === 'listen' ? 'album' : 'all' });
      expect(url(paths.href).pathname).toBe('/library');
      expect(url(paths.href).searchParams.get('view')).toBe(surface);
      expect(url(paths.api).searchParams.get('surface')).toBe(surface);
      expect(url(paths.href).searchParams.get('collection')).toBe('false');
    }
  });
  test('existing home preview links retain their destination', () => {
    expect(url(libraryBrowsePaths({ ...base, surface: 'play' }, { personal: true }).href).pathname).toBe('/games');
    expect(url(libraryBrowsePaths({ ...base, surface: 'listen' }, {}).href).pathname).toBe('/music');
  });
});
