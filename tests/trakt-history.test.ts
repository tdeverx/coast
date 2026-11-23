import { expect, test } from 'bun:test';
import { compactTraktHistory, type TraktHistoryTitles } from '../src/lib/sync/trakt-history';
import { TraktAdapter, type TraktRecord } from '../src/lib/providers/trakt/adapter.server';

test('compact history preserves chronological ties, source IDs and timestamp fallbacks', () => {
  const titles: TraktHistoryTitles = new Map();
  const movie = { title: 'Rewatched', runtime: 90, ids: { trakt: 7, imdb: 'tt7' } };
  const records: TraktRecord[] = [
    { id: 9, watched_at: '2026-03-01T00:00:00Z', movie, metadata: { unused: 'payload' } },
    { id: 8, watched_at: '2026-01-01T00:00:00Z', movie: structuredClone(movie) },
    { id: 4, watched_at: '2026-01-01T00:00:00Z', movie: structuredClone(movie) },
    { paused_at: '2026-02-01T00:00:00Z', movie },
  ];
  const order = (a: TraktRecord, b: TraktRecord) => (a.watched_at || '').localeCompare(b.watched_at || '');
  const used = (record: TraktRecord) => ({
    id: record.id, movie: record.movie,
    timestamp: record.watched_at || record.paused_at || record.rated_at || record.collected_at || record.listed_at,
  });
  const compact = records.map((record) => compactTraktHistory(record, titles)).sort(order);
  expect(compact.map(used)).toEqual([...records].sort(order).map(used));
  expect(compact.map((record) => record.id)).toEqual([undefined, 8, 4, 9]);
  expect(compact.every((record) => record.movie === compact[0].movie)).toBe(true);
  expect(compact.some((record) => record.metadata)).toBe(false);
});

test('title sharing separates media kinds, changed metadata and episode parent shows', () => {
  const titles: TraktHistoryTitles = new Map();
  const show = { title: 'Show', runtime: 45, ids: { trakt: 7 } };
  const episode = { title: 'Episode', season: 1, number: 2, ids: { trakt: 7 } };
  const first = compactTraktHistory({ show, episode }, titles);
  const repeat = compactTraktHistory({ show: structuredClone(show), episode: structuredClone(episode) }, titles);
  expect(repeat.show).toBe(first.show);
  expect(repeat.episode).toBe(first.episode);
  expect(repeat.episode).not.toBe(first.show);
  const changed = compactTraktHistory({ show: { ...show, runtime: 60 }, episode }, titles);
  expect(changed.show?.runtime).toBe(60);
  expect(changed.show).not.toBe(first.show);
  expect(first.show?.runtime).toBe(45);
  expect(changed.episode).toBe(first.episode);
});

test('history title sharing remains bounded without discarding records', () => {
  const titles: TraktHistoryTitles = new Map();
  let first: TraktRecord | undefined;
  for (let id = 1; id <= 10_001; id++) {
    const record = compactTraktHistory({ id, movie: { title: `Movie ${id}`, ids: { trakt: id } } }, titles);
    first ??= record;
  }
  expect(titles.size).toBe(1);
  expect(first?.movie?.title).toBe('Movie 1');
  expect(titles.has('movie:1')).toBe(false);
});

test('history export finds the exact episode ID through TMDB, TVDB or IMDb', async () => {
  const ids = { trakt: 7, tmdb: 10, tvdb: 20, imdb: 'tt30' };
  const episode = { title: 'Story episode', season: 1, number: 2, ids };
  const wrongEpisode = { ...episode, ids: { ...ids, trakt: 8, tmdb: 11, tvdb: 21, imdb: 'tt31' } };
  const paths: string[] = [];
  const adapter = new TraktAdapter(async path => {
    paths.push(path);
    return [{ show: { title: 'Story', ids } }, { episode: wrongEpisode }, { episode }];
  }, 'fixture', 'fixture');
  expect(await adapter.resolveExactId('episode', { tmdb: 10, tvdb: 20, imdb: 'tt30' })).toBe(7);
  expect(await adapter.resolveExactId('episode', { tvdb: 20 })).toBe(7);
  expect(await adapter.resolveExactId('episode', { imdb: 'tt30' })).toBe(7);
  expect(paths).toEqual(['/search/tmdb/10?type=episode', '/search/tvdb/20?type=episode', '/search/imdb/tt30?type=episode']);
});

test('history export skips absent, conflicting and ambiguous identities', async () => {
  const movie = { title: 'Film', ids: { trakt: 7, tmdb: 10, tvdb: 20 } };
  const adapter = new TraktAdapter(async path => {
    if (path === '/search/tmdb/12?type=movie') return [{ movie }, { movie: { ...movie, ids: { trakt: 8, tmdb: 12 } } }, { movie: { ...movie, ids: { trakt: 9, tmdb: 12 } } }];
    if (path === '/search/tmdb/11?type=movie') return [{ movie: { ...movie, ids: { trakt: 8, tmdb: 11 } } }];
    if (path === '/search/imdb/tt30?type=movie') return [{ movie: { ...movie, ids: { trakt: 9, imdb: 'tt30' } } }];
    return [{ movie }];
  }, 'fixture', 'fixture');
  expect(await adapter.resolveExactId('movie', {})).toBeUndefined();
  expect(await adapter.resolveExactId('movie', { tmdb: 999 })).toBeUndefined();
  expect(await adapter.resolveExactId('movie', { trakt: 7, tmdb: 11 })).toBeUndefined();
  expect(await adapter.resolveExactId('movie', { tmdb: 11, imdb: 'tt30' })).toBeUndefined();
  expect(await adapter.resolveExactId('movie', { tmdb: 12 })).toBeUndefined();
});
