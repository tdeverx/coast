import { expect, test } from 'bun:test';
import type { JournalEntry } from '../src/lib/profile/journal';
import { journalDay, visibleJournalEntries } from '../src/lib/ui/shelves/journal-visible';

const items = [
  { eventId: 'recent', watchedAt: '2026-10-03T12:00:00Z' },
  { eventId: 'unknown', watchedAt: '2026-10-03T11:00:00Z', dateKnown: false },
  { eventId: 'rewatch', watchedAt: '2026-10-03T10:00:00Z' },
  { eventId: 'older', watchedAt: '2026-10-02T10:00:00Z' },
] as JournalEntry[];
const days = [...new Set(items.map(journalDay))];

test('unlimited journal history uses the original ordered items without filtering', () => {
  expect(visibleJournalEntries(items, days, Infinity)).toBe(items);
});

test('finite journal day limits preserve unknown dates, rewatches and fractional boundary behavior', () => {
  for (const limit of [-1, 0, 1, 1.5, 2, 12, NaN, -Infinity]) {
    const expected = items.filter(item => days.indexOf(journalDay(item)) < limit);
    expect(visibleJournalEntries(items, days, limit).map(item => item.eventId)).toEqual(expected.map(item => item.eventId));
  }
  expect(visibleJournalEntries(items, days, 1).map(item => item.eventId)).toEqual(['recent', 'rewatch']);
  expect(visibleJournalEntries(items, days, 2).map(item => item.eventId)).toEqual(['recent', 'unknown', 'rewatch']);
  expect(visibleJournalEntries([], [], 2)).toEqual([]);
});
