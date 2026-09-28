/** Shared tracking language. Only Film & TV is enabled by the current catalog/adapters. */
export type MediaCategory = 'screen' | 'book' | 'comic' | 'game';
export type ScreenKind = 'movie' | 'show' | 'season' | 'episode' | 'collection';
export type Lifecycle = 'planned' | 'in-progress' | 'completed' | 'paused' | 'dropped';
export type ProgressUnit =
  | 'seconds'
  | 'pages'
  | 'chapters'
  | 'issues'
  | 'episodes'
  | 'percent'
  | 'minutes-played';
export interface Progress {
  unit: ProgressUnit;
  value: number;
  total?: number;
}
export interface Work {
  id: string;
  category: MediaCategory;
  title: string;
}
export interface Edition {
  id: string;
  workId: string;
  format: string;
  platform?: string;
}
export interface ActivitySession {
  id: string;
  workId: string;
  editionId?: string;
  status: Lifecycle;
  progress?: Progress;
  startedAt: string | null;
  completedAt: string | null;
  repeat: boolean;
}
export type WorkRelationship = 'contains' | 'sequence' | 'related';
export type MediaRelationship = WorkRelationship | 'collection' | 'franchise';
export const mediaCategories = {
  screen: {
    label: 'Film & TV',
    completed: 'Watched',
    repeat: 'Rewatched',
    action: 'Play',
    shape: 'poster',
  },
  book: { label: 'Books', completed: 'Read', repeat: 'Reread', action: 'Read', shape: 'poster' },
  comic: { label: 'Comics', completed: 'Read', repeat: 'Reread', action: 'Read', shape: 'poster' },
  game: {
    label: 'Games',
    completed: 'Played',
    repeat: 'Replayed',
    action: 'Open',
    shape: 'square',
  },
} as const;
export function validProgress(progress: Progress): boolean {
  if (
    !['seconds', 'pages', 'chapters', 'issues', 'episodes', 'percent', 'minutes-played'].includes(
      progress.unit
    )
  )
    return false;
  const integers = ['pages', 'chapters', 'issues', 'episodes'];
  return (
    Number.isFinite(progress.value) &&
    progress.value >= 0 &&
    (!integers.includes(progress.unit) || Number.isInteger(progress.value)) &&
    (progress.total === undefined ||
      (Number.isFinite(progress.total) &&
        progress.total > 0 &&
        progress.value <= progress.total &&
        (!integers.includes(progress.unit) || Number.isInteger(progress.total)))) &&
    (progress.unit !== 'percent' ||
      (progress.value <= 100 && (progress.total === undefined || progress.total === 100)))
  );
}
export function progressFraction(progress: Progress): number | null {
  if (!validProgress(progress)) return null;
  const total = progress.unit === 'percent' ? 100 : progress.total;
  return total ? progress.value / total : null;
}
export function lifecycle(input: {
  completed: boolean;
  dropped: boolean;
  paused?: boolean;
  planned: boolean;
  progress?: Progress;
}): Lifecycle | null {
  if (input.dropped) return 'dropped';
  if (input.completed) return 'completed';
  if (input.paused) return 'paused';
  if (input.progress && input.progress.value > 0) return 'in-progress';
  return input.planned ? 'planned' : null;
}
/** Ownership deliberately does not imply an app can open or play a work. */
export function primaryMediaAction(input: {
  category: MediaCategory;
  canOpen: boolean;
  canRequest: boolean;
}): 'play' | 'read' | 'open' | 'request' | 'progress' {
  if (input.canOpen)
    return input.category === 'screen' ? 'play' : input.category === 'game' ? 'open' : 'read';
  return input.canRequest ? 'request' : 'progress';
}

/** Menu categories stay stable while actions use the medium's vocabulary. */
export function trackingLanguage(category: MediaCategory) {
  const verb = category === 'screen' ? 'watch' : category === 'game' ? 'playthrough' : 'read';
  const repeat =
    category === 'screen' ? 'rewatching' : category === 'game' ? 'replaying' : 'rereading';
  return {
    mark:
      category === 'screen' ? 'Mark watched' : category === 'game' ? 'Mark completed' : 'Mark read',
    unmark:
      category === 'screen'
        ? 'Mark unwatched'
        : category === 'game'
          ? 'Mark unfinished'
          : 'Mark unread',
    log: `Log a ${verb}…`,
    logAgain: `Log another ${verb}…`,
    startRepeat: `Start ${repeat}…`,
    stopRepeat: `Stop ${repeat}`,
  };
}
