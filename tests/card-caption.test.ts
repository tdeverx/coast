import { expect, test } from 'bun:test';
import { cardLibraryLink, screenCardCaption } from '../src/lib/ui/card-caption';
import { cardSlotData } from '../src/lib/ui/card-slots';
import type { MediaView } from '../src/lib/ui/types';

const movie: MediaView = {
  id: 'movie', kind: 'movie', title: 'Movie title', certification: '12', runtimeMinutes: 120,
  available: true, progress: 1800, duration: 7200, watched: false, playCount: 0,
  watchlist: false, favourite: false, collected: false, dropped: false, rating: null,
};

test('movie captions choose time left or runtime and link the age certificate', () => {
  expect(screenCardCaption(movie, true)).toMatchObject({ label: { text: '12', href: '/media/movie' }, detail: '1h 30m left' });
  expect(screenCardCaption(movie, false).detail).toBe('2h');
  expect(screenCardCaption({ ...movie, watched: true }, true).detail).toBe('2h');
  expect(screenCardCaption({ ...movie, duration: 0, trackingProgress: { unit: 'seconds', value: 1800 } }, true).detail).toBe('1h 30m left');
});

test('episode captions link the show and season independently and prefix the episode title', () => {
  const episode: MediaView = {
    ...movie, kind: 'episode', title: 'Episode title', showId: 'show', showTitle: 'Show title', seasonId: 'season',
    seasonNumber: 0, episodeNumber: 2, progress: 0, duration: 0, runtimeMinutes: 45,
  };
  expect(screenCardCaption(episode, true)).toEqual({
    title: '2. Episode title', context: { text: 'Show title', href: '/media/show' },
    label: { text: 'S00', href: '/media/season' }, detail: '45m',
  });
  expect(screenCardCaption({ ...episode, seasonId: undefined }, true).label?.href).toBeUndefined();
});

test('show, season and box set captions show behind counts only when known', () => {
  for (const kind of ['show', 'season', 'collection'] as const) {
    const group: MediaView = { ...movie, kind, totalEpisodes: 8, completedEpisodes: 3 };
    expect(screenCardCaption(group, true).detail).toBe('5 behind');
    expect(screenCardCaption({ ...group, totalEpisodes: undefined }, true).detail).toBeUndefined();
  }
  expect(screenCardCaption({ ...movie, kind: 'season', title: '', seasonNumber: 1 }, true).title).toBe('Season 1');
  expect(cardLibraryLink('track')?.href).toBe('/library?view=listen&kind=track');
  expect(cardLibraryLink('game')?.href).toBe('/library?view=play&kind=all');
});

test('metadata slots resolve individual values and preserve contextual links', () => {
  const slots = cardSlotData({
    ...movie, kind: 'episode', year: 2024, showId: 'show', showTitle: 'Show title',
    seasonId: 'season', seasonNumber: 0, episodeNumber: 2,
  });
  expect(slots.runtime).toMatchObject([{ text: '2h' }]);
  expect(slots['time-left']).toMatchObject([{ text: '1h 30m left' }]);
  expect(slots.certification).toEqual([{ text: '12', href: '/media/movie' }]);
  expect(slots.season).toEqual([{ text: 'S00', href: '/media/season' }]);
  expect(slots.show).toEqual([{ text: 'Show title', href: '/media/show' }]);
});

test('metadata slots leave unavailable fields empty and use the medium’s progress', () => {
  const book = { id: 'book', kind: 'book' as const, title: 'Book', href: '/media/book',
    trackingProgress: { unit: 'pages' as const, value: 30, total: 120 } };
  const slots = cardSlotData(book);
  expect(slots.runtime).toEqual([]);
  expect(slots.year).toEqual([]);
  expect(slots.certification).toEqual([]);
  expect(slots.progress).toMatchObject([{ text: '25%' }]);
  expect(cardSlotData(movie, 0.6).progress).toMatchObject([{ text: '60%' }]);
});

test('configured field values work with missing sample data and retain links', () => {
  const item = { ...movie, certification: null, progress: 0 };
  const values = { certification: 'PG', runtime: '95 minutes', actor: 'Preview author' };
  const slots = cardSlotData(item, undefined, values);
  expect(slots.actor).toEqual([{ text: 'Preview author', href: undefined }]);
  expect(screenCardCaption(item, true, values)).toMatchObject({ label: { text: 'PG', href: '/media/movie' }, detail: '95 minutes' });
  expect(cardSlotData(movie, undefined, values).certification).toEqual([{ text: 'PG', href: '/media/movie' }]);
});
