import type { JournalEntry } from '$lib/profile/journal';
import { mediaCategories } from '$lib/media/model';

export type JournalSelection = { checked: (id: string) => boolean; toggle: (id: string) => void; disabled?: boolean };
export type JournalCards = { runs: JournalEntry[][]; selection?: JournalSelection };
export type ActivityNote = { action: string; pending: boolean; date?: string; time: string; source: string; repeat: string };
export type JournalCard = { key: string; item: JournalEntry; activity: JournalEntry; note: ActivityNote; run?: { href: string; title: string; note: ActivityNote }[] };
const time = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
function sourceLabel(item: JournalEntry) {
  return item.source === 'playback'
    ? item.action && item.action !== 'watch' ? 'Playback in Coast' : `${mediaCategories[item.category ?? 'screen'].completed} in Coast`
    : item.source.startsWith('coast') ? 'Recorded in Coast'
    : item.source === 'trakt' ? 'Imported from Trakt'
    : item.source === 'jellyfin' ? 'Imported from Jellyfin' : 'Imported activity';
}
export function activityNote(item: JournalEntry): ActivityNote {
  return {
    action: item.action === 'unwatch' ? 'Marked unwatched' : item.action === 'progress'
      ? `Progress updated${item.positionSeconds != null ? ` · ${Math.floor(item.positionSeconds / 60)} min` : ''}` : '',
    pending: item.applied === false,
    date: item.dateKnown === false ? undefined : item.watchedAt,
    time: item.dateKnown === false ? 'Date unknown' : `${time(item.watchedAt)} UTC`,
    source: sourceLabel(item),
    repeat: item.rewatched ? mediaCategories[item.category ?? 'screen'].repeat : '',
  };
}
/** Adapt activity to the same card renderer; selected histories expand runs into individual events. */
export function journalCards(runs: JournalEntry[][], selectable = false): JournalCard[] {
  return runs.filter(run => run.length).flatMap(run => {
    if (selectable || run.length === 1) return run.map(item => ({ key: item.eventId, item, activity: item, note: activityNote(item) }));
    const first = run[0];
    return [{ key: first.eventId, activity: first, note: activityNote(first),
      item: { ...first, captionSubtitle: `${run.length} episodes · ${first.dateKnown === false ? 'Date unknown' : `${time(run.at(-1)!.watchedAt)}–${time(first.watchedAt)} UTC`}` },
      run: run.map(item => ({ href: `/media/${item.id}`, title: item.captionSubtitle || item.title, note: activityNote(item) })),
    }];
  });
}
