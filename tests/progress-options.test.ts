import { expect, test } from 'bun:test';
import { progressParameters, progressSurface } from '../src/lib/progress';

test('saved rows and profile-only statuses select their own presentation', () => {
  expect(progressSurface('recommendations', false)).toBe('recommendations');
  expect(progressSurface('watching', false)).toBe('continue');
  expect(progressSurface('watching', true)).toBe('profile');
  for (const view of ['finished', 'dropped']) expect(progressSurface(view, false)).toBe('profile');
  for (const profile of [false, true]) {
    expect(progressSurface('watchlist', profile)).toBe('watchlist');
    expect(progressSurface('favourites', profile)).toBe('favourites');
  }
});

test('availability follows playable shelves while profile progress stays all', () => {
  const params = (query: string) =>
    progressParameters(new URL('https://coast.test/progress?' + query));
  expect(params('view=watching&scope=available').scope).toBe('available');
  expect(params('view=up-next&scope=available').scope).toBe('available');
  expect(params('username=admin&view=watching&scope=available').scope).toBe('all');
  for (const view of ['watchlist', 'favourites'])
    expect(params('view=' + view + '&scope=available').scope).toBe('available');
  for (const view of ['finished', 'dropped'])
    expect(params('view=' + view + '&scope=available').scope).toBe('all');
  expect(params('username=admin&view=finished&kind=show&page=2')).toEqual({
    view: 'finished',
    category: undefined,
    kind: 'show',
    scope: 'all',
    page: 2,
  });
});
