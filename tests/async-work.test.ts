import { expect, test } from 'bun:test';
import { mapConcurrent, singleFlight } from '../src/lib/server/utils/async';

test('bounded work preserves order and never exceeds its connection budget', async () => {
  let active = 0,
    peak = 0;
  const result = await mapConcurrent([4, 3, 2, 1], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active--;
    return value * 2;
  });
  expect(result).toEqual([8, 6, 4, 2]);
  expect(peak).toBe(2);
  expect(active).toBe(0);
});

test('failed batches finish active workers and stop scheduling further writes', async () => {
  const started: number[] = [],
    finished: number[] = [];
  await expect(
    mapConcurrent([0, 1, 2, 3], 2, async (value) => {
      started.push(value);
      if (value === 0) throw new Error('provider unavailable');
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished.push(value);
    })
  ).rejects.toThrow('provider unavailable');
  expect(started).toEqual([0, 1]);
  expect(finished).toEqual([1]);
});

test('concurrent refreshes share work, isolate keys and allow retry after failure', async () => {
  const run = singleFlight<number>();
  let calls = 0;
  const work = async () => ++calls;
  expect(await Promise.all([run('a', work), run('a', work), run('b', work)])).toEqual([1, 1, 2]);
  expect(await run('a', work)).toBe(3);
  await expect(
    run('a', async () => {
      throw new Error('offline');
    })
  ).rejects.toThrow('offline');
  expect(await run('a', work)).toBe(4);
});
