import { expect, test } from 'bun:test';
import { activityNote, journalCards } from '../src/lib/ui/shelves/journal-cards';
import type { JournalEntry } from '../src/lib/profile/journal';
const entry = (eventId: string, patch: Partial<JournalEntry> = {}): JournalEntry => ({
  id: 'episode', kind: 'episode', title: 'An episode', available: false, progress: 0, duration: 0,
  watched: true, playCount: 1, watchlist: false, favourite: false, collected: false, dropped: false, rating: null,
  eventId, watchedAt: '2026-10-01T12:00:00Z', source: 'jellyfin', rewatched: false, ...patch,
});
test('history selection retains distinct event identities when the same work is watched repeatedly', () => {
  const runs = [[entry('one'), entry('two', { rewatched: true })]];
  const selectable = journalCards(runs, true);
  expect(selectable.map(card => card.key)).toEqual(['one', 'two']);
  expect(selectable.map(card => card.activity.eventId)).toEqual(['one', 'two']);
  expect(selectable.every(card => !card.run)).toBe(true);
  expect(selectable[1].note.repeat).toBe('Rewatched');
});
test('collapsed episode runs preserve every member link and time while empty runs remain harmless', () => {
  const cards = journalCards([[], [entry('one', { id: 'first' }), entry('two', { id: 'second', watchedAt: '2026-10-01T11:00:00Z' })]]);
  expect(cards).toHaveLength(1);
  expect(cards[0].run?.map(item => item.href)).toEqual(['/media/first', '/media/second']);
  expect(cards[0].item.captionSubtitle).toContain('2 episodes');
  expect(cards[0].run?.every(item => item.note.date)).toBe(true);
});
test('pending undated progress stays explicit rather than acquiring a watch timestamp or completion label', () => {
  const note = activityNote(entry('pending', { action: 'progress', applied: false, dateKnown: false, positionSeconds: 125, source: 'playback' }));
  expect(note).toMatchObject({ date: undefined, time: 'Date unknown', pending: true, action: 'Progress updated · 2 min', source: 'Playback in Coast' });
});
