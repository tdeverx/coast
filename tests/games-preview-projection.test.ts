import {expect, test} from 'bun:test';
import {listGames} from '../src/lib/core/games/service.server';

test('game projection rejects invalid bounds before reading data', async () => {
  for (const limit of [0, -1, 1.5, 61, Number.NaN, Number.POSITIVE_INFINITY])
    await expect(listGames('', 1, undefined, limit)).rejects.toThrow();
});

test('a reduced game projection cannot change search ranking or page offsets', async () => {
  await expect(listGames('query', 1, undefined, 12)).rejects.toThrow('first unsearched page');
  await expect(listGames('', 2, undefined, 12)).rejects.toThrow('first unsearched page');
});
