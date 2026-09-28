import type { ActivitySession } from '$lib/media/model';
import type { MediaView } from '$lib/ui/types';
export type JournalEntry = MediaView & {
  eventId: string;
  action?: 'watch' | 'unwatch' | 'progress';
  applied?: boolean;
  positionSeconds?: number | null;
  dateKnown?: boolean;
  activity?: ActivitySession;
  watchedAt: string;
  source: string;
  rewatched: boolean;
};
export function journalGroups(items: JournalEntry[]) {
  const days: { date: string; runs: JournalEntry[][]; count: number }[] = [];
  for (const item of items) {
    const date = item.dateKnown === false ? 'unknown' : item.watchedAt.slice(0, 10);
    let day = days.at(-1);
    if (day?.date !== date) {
      day = { date, runs: [], count: 0 };
      days.push(day);
    }
    const run = day.runs.at(-1),
      previous = run?.at(-1);
    if (
      (!item.action || item.action === 'watch') &&
      item.applied !== false &&
      (!previous?.action || previous.action === 'watch') &&
      previous?.applied !== false &&
      item.kind === 'episode' &&
      item.showId &&
      previous?.kind === 'episode' &&
      previous.showId === item.showId
    )
      run!.push(item);
    else day.runs.push([item]);
    day.count++;
  }
  return days;
}
