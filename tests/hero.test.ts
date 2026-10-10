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

test('reading cards are eligible hero titles with canonical identities while people remain excluded', () => {
  const bookId = 'e8ed0c85-cc66-4e3b-8813-7b2538b6c2f9';
  const comicId = 'feebfdb1-fbf7-4498-8efb-ad19fb3c8f45';
  const book = { id: bookId, kind: 'book' as const, title: 'A reading title', href: `/media/${bookId}`, captionSubtitle: 'A writer', year: 2020 };
  const comic = { id: comicId, kind: 'comic' as const, title: 'A comic issue', href: `/media/${comicId}`, captionSubtitle: 'A series #1', attribution: { label: 'Comic Vine', href: 'https://comicvine.gamespot.com/issue/4000-1/' } };
  const person = { id: 'person', kind: 'person' as const, title: 'A writer', href: '/people/person' };

  expect(isHeroTitle(book)).toBe(true);
  expect(isHeroTitle(comic)).toBe(true);
  expect(isHeroTitle(person)).toBe(false);
  expect(heroTitleIds([book, comic, { ...book }, person])).toEqual([bookId, comicId]);
});
