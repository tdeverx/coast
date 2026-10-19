import { expect, test } from 'bun:test';
import { searchSelection, searchSelectionUrl, searchDemand, searchRowMatches } from '../src/lib/search-selection';

const parse = (query: string) => searchSelection(new URLSearchParams(query));
const features = { experimentalMusic: true, experimentalGaming: true, experimentalBooks: true, experimentalComics: true };

test('incoming view/type scopes gate only their requested media and All retains enabled demand', () => {
  expect(searchDemand(parse('q=title'), features)).toEqual({ watch: true, listen: true, play: true, read: true });
  for (const surface of ['watch', 'listen', 'play', 'read']) {
    const demand = searchDemand(parse(`q=title&view=${surface}`), features);
    expect(Object.entries(demand).filter(([, active]) => active).map(([key]) => key)).toEqual([surface]);
  }
  expect(searchDemand(parse('type=book'), features)).toEqual({ watch: false, listen: false, play: false, read: true });
  expect(searchDemand(parse('q=title'), { ...features, features: { screen: false, music: false, book: false, comic: false } })).toEqual({ watch: false, listen: false, play: true, read: false });
});

test('independent row primitives retain the other row default scope and form a demand union', () => {
  const selected = parse('view=read&availableType=movie');
  expect(selected.rows).toEqual({ available: { kind: 'movie', view: 'watch' }, unavailable: { kind: 'all', view: 'read' } });
  expect(searchDemand(selected, features)).toEqual({ watch: true, listen: false, play: false, read: true });
  expect(parse('availableType=movie&unavailableType=comic').rows.unavailable).toEqual({ kind: 'comic', view: 'read' });
  expect(searchDemand(parse('availableType=movie'), features)).toEqual({ watch: true, listen: true, play: true, read: true });
  expect(searchRowMatches(selected.rows.unavailable, 'movie')).toBe(false);
  expect(searchRowMatches(selected.rows.unavailable, 'comic')).toBe(true);
});

test('row changes, query changes and Back URLs preserve independent selections and clear stale paging', () => {
  const initial = new URL('http://coast/search?q=old&view=read&kind=book&page=3&scope=providers');
  const movie = new URL(searchSelectionUrl(initial, 'old', { bucket: 'available', kind: 'movie' }), initial);
  expect(movie.searchParams.get('availableType')).toBe('movie');
  expect(movie.searchParams.has('unavailableType')).toBe(false);
  expect(movie.searchParams.has('page')).toBe(false);
  expect(movie.searchParams.has('scope')).toBe(false);
  const comic = new URL(searchSelectionUrl(movie, 'old', { bucket: 'unavailable', kind: 'comic' }), initial);
  const edited = new URL(searchSelectionUrl(comic, ' next '), initial);
  expect(edited.searchParams.get('q')).toBe('next');
  expect(parse(edited.search).rows).toEqual({ available: { kind: 'movie', view: 'watch' }, unavailable: { kind: 'comic', view: 'read' } });
  // Re-reading earlier history restores both primitives without local state surviving navigation.
  expect(parse(movie.search).rows.unavailable).toEqual({ kind: 'book', view: 'read' });
  expect(parse(initial.search).rows.available).toEqual({ kind: 'book', view: 'read' });
  const all = new URL(searchSelectionUrl(comic, 'old', { bucket: 'available', kind: 'all' }), initial);
  expect(parse(all.search).rows).toEqual({ available: { kind: 'all', view: 'all' }, unavailable: { kind: 'comic', view: 'read' } });
});

test('reading subtype/page cap stays explicit and independent row overrides can request both subtypes', () => {
  expect(parse('type=book').readingInput).toEqual({ kind: 'all', page: 1 });
  expect(parse('view=read&kind=book&page=2').readingInput).toEqual({ kind: 'book', page: 2 });
  expect(parse('view=read&kind=book&page=2&unavailableType=comic').readingInput).toEqual({ kind: 'all', page: 2 });
  expect(parse('view=read&kind=book&page=2&unavailableType=all').readingInput).toEqual({ kind: 'all', page: 2 });
  for (const query of ['view=invalid', 'type=invalid', 'availableType=invalid', 'unavailableType=invalid', 'view=read&page=0', 'view=read&page=1001']) expect(() => parse(query)).toThrow();
  expect(parse('q=' + 'a'.repeat(250)).query).toHaveLength(200);
  expect(parse('availableType=book').filtered).toBe(true);
});
