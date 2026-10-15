import { expect, test } from 'bun:test';
import { normalizeSearch, rankSearch, searchFallback, searchScore } from '../src/lib/search';

test('all media share exact, phrase, words and typo ranking with stable ties', () => {
  const items = [
    { title: 'Quinn Harley' }, { title: 'Harley Quinn: Adventures' },
    { title: 'Harley Quinn' }, { title: 'Harly Quinn' }, { title: 'Other', seriesTitle: 'Harley Quinn' },
  ];
  expect(rankSearch(items, 'HARLEY: quinn').map(item => item.title)).toEqual([
    'Harley Quinn', 'Harley Quinn: Adventures', 'Other', 'Quinn Harley', 'Harly Quinn',
  ]);
  expect(searchScore('quinn', { title: 'Quin' })).toBe(550);
  expect(searchScore('queen', { title: 'Quinn' })).toBe(0);
  expect(searchScore('quinn', { title: 'Qunin' })).toBe(550);
  expect(searchScore('quinn', { title: 'Quxinn' })).toBe(550);
  const ties = [{ title: 'Dune', kind: 'book' }, { title: 'Dune', kind: 'movie' }];
  expect(rankSearch(ties, 'dune')).toEqual(ties);
  expect(rankSearch(ties, '')).toEqual(ties);
});

test('literal punctuation cannot become query operators and fallback is bounded', () => {
  expect(normalizeSearch('Harley Quinn: The Animated—Series')).toBe('harley quinn the animated series');
  expect(normalizeSearch('100%_literal | !query')).toBe('100 literal query');
  expect(searchFallback('quinn')).toBe('qui');
  expect(searchFallback('Harley: Quinn')).toBe('harley quinn');
  expect(searchFallback('Up')).toBe('');
  expect(searchScore('Pratchett', { title: 'Discworld', authors: ['Terry Pratchett'] })).toBe(680);
});
