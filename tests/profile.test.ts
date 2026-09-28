import { periodStart } from '../src/lib/profile/period';
import { journalGroups, type JournalEntry } from '../src/lib/profile/journal';
import { test, expect } from 'bun:test';
import { activityBuckets } from '../src/lib/profile/activity';

test('activity fills quiet days and excludes records outside the selected UTC window', () => {
  const buckets = activityBuckets(
    [
      { date: '2026-08-28', movies: 99, episodes: 0 },
      { date: '2026-08-29', movies: 1, episodes: 2 },
      { date: '2026-09-27', movies: 3, episodes: 4 },
      { date: '2026-09-28', movies: 99, episodes: 0 },
    ],
    '2026-09-27',
    '30'
  );
  expect(buckets).toHaveLength(30);
  expect(buckets[0]).toEqual({ date: '2026-08-29', end: '2026-08-29', movies: 1, episodes: 2 });
  expect(buckets[1].movies).toBe(0);
  expect(buckets.reduce((sum, day) => sum + day.movies, 0)).toBe(4);
});
test('longer periods preserve totals in bounded weekly and calendar-month buckets', () => {
  const days = [{ date: '2026-09-27', movies: 2, episodes: 3 }];
  for (const [period, length] of [
    ['90', 13],
    ['year', 13],
  ] as const) {
    const buckets = activityBuckets(days, '2026-09-27', period);
    expect(buckets).toHaveLength(length);
    expect(buckets.at(-1)?.end).toBe('2026-09-27');
    expect(buckets.reduce((sum, day) => sum + day.movies + day.episodes, 0)).toBe(5);
  }
});

test('annual buckets follow calendar months', () => {
  const buckets = activityBuckets([], '2026-09-27', 'year');
  expect(buckets[1].date).toBe('2025-10-01');
  expect(buckets[1].end).toBe('2025-10-31');
});

test('period bounds and all-time buckets keep old history', () => {
  expect(periodStart('month', new Date('2026-09-27T12:00:00Z'))).toBe('2026-08-29');
  expect(periodStart('all')).toBeUndefined();
  const buckets = activityBuckets(
    [{ date: '2000-01-01', movies: 1, episodes: 0 }],
    '2026-09-27',
    'all'
  );
  expect(buckets).toHaveLength(27);
  expect(buckets[0].movies).toBe(1);
});
test('journal groups only consecutive episodes within the same UTC day', () => {
  const entry = (id: string, showId: string, day: string, kind = 'episode') =>
    ({ eventId: id, id, showId, kind, watchedAt: `2026-09-${day}T12:00:00Z` }) as JournalEntry;
  const groups = journalGroups([
    entry('1', 'show', '27'),
    entry('2', 'show', '27'),
    entry('3', 'other', '27'),
    entry('4', 'show', '27'),
    entry('5', 'show', '26'),
  ]);
  expect(groups.map((d) => d.runs.map((r) => r.length))).toEqual([[2, 1, 1], [1]]);
});
