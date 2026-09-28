import { expect, test } from 'bun:test';
import { heroTitleIds, isHeroTitle } from '../src/lib/media/hero';

test('browsing heroes promote episodes and seasons to shows and deduplicate title identities', () => {
  expect(
    heroTitleIds([
      { id: 'episode', kind: 'episode', showId: 'show' },
      { id: 'season', kind: 'season', showId: 'show' },
      { id: 'show', kind: 'show' },
      { id: 'movie', kind: 'movie' },
      { id: 'collection', kind: 'collection' },
      { id: 'orphan', kind: 'episode' },
    ])
  ).toEqual(['show', 'movie']);
  expect(isHeroTitle({ kind: 'season' })).toBe(false);
  expect(isHeroTitle({ kind: 'episode' })).toBe(false);
});
