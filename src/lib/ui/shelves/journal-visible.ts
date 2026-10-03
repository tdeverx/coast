import type { JournalEntry } from '$lib/profile/journal';

export const journalDay = (item: JournalEntry) =>
  item.dateKnown === false ? 'unknown' : item.watchedAt.slice(0, 10);

/** Preserve event order and the existing fractional/unknown-day selection rules. */
export function visibleJournalEntries(items: JournalEntry[], days: string[], maxDays: number) {
  if (maxDays === Infinity) return items;
  const allowed = new Set(days.filter((_, index) => index < maxDays));
  return items.filter(item => allowed.has(journalDay(item)));
}
