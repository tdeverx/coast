import { lifecycle } from '$lib/media/model';
export type TrackingAction =
  | 'watch'
  | 'unwatch'
  | 'progress'
  | 'drop'
  | 'restore'
  | 'watchlist'
  | 'favourite'
  | 'collect';
export interface TrackingProjection {
  watched: boolean;
  playCount: number;
  positionSeconds: number;
  durationSeconds: number | null;
  watchlist: boolean;
  favourite: boolean;
  collected: boolean;
  dropped: boolean;
  completedEpisodes: number;
  totalEpisodes: number;
  lastWatchedAt: Date | null;
}
export interface TrackingChange {
  action: TrackingAction;
  value?: boolean;
  positionSeconds?: number;
  durationSeconds?: number;
  rewatch?: boolean;
  occurredAt?: Date | null;
}
export const emptyTrackingState = (): TrackingProjection => ({
  watched: false,
  playCount: 0,
  positionSeconds: 0,
  durationSeconds: null,
  watchlist: false,
  favourite: false,
  collected: false,
  dropped: false,
  completedEpisodes: 0,
  totalEpisodes: 0,
  lastWatchedAt: null,
});

/** Completion is canonical. A duration refresh alone is not progress and cannot undrop. */
export function projectTracking(
  previous: TrackingProjection,
  change: TrackingChange
): { state: TrackingProjection; changed: boolean; progressChanged: boolean } {
  const state = { ...previous };
  let progressChanged = false;
  switch (change.action) {
    case 'watch':
      if (!state.watched || change.rewatch) {
        state.watched = true;
        state.playCount += 1;
        state.positionSeconds =
          change.durationSeconds ?? state.durationSeconds ?? state.positionSeconds;
        state.durationSeconds = change.durationSeconds ?? state.durationSeconds;
        const occurredAt = change.occurredAt === undefined ? new Date() : change.occurredAt;
        state.lastWatchedAt =
          !occurredAt || (state.lastWatchedAt && state.lastWatchedAt > occurredAt)
            ? state.lastWatchedAt
            : occurredAt;
        progressChanged = true;
      }
      break;
    case 'unwatch':
      progressChanged = state.watched || state.positionSeconds !== 0;
      state.watched = false;
      state.positionSeconds = 0;
      // Play count and viewing history remain historical; marking unwatched is not erasure.
      break;
    case 'progress': {
      const position = change.positionSeconds ?? state.positionSeconds;
      progressChanged = position !== state.positionSeconds;
      state.positionSeconds = position;
      state.durationSeconds = change.durationSeconds ?? state.durationSeconds;
      break;
    }
    case 'drop':
      state.dropped = true;
      break;
    case 'restore':
      state.dropped = false;
      break;
    case 'watchlist':
      state.watchlist = change.value ?? true;
      break;
    case 'favourite':
      state.favourite = change.value ?? true;
      break;
    case 'collect':
      state.collected = change.value ?? true;
      break;
  }
  if (progressChanged) state.dropped = false;
  const changed = (Object.keys(state) as Array<keyof TrackingProjection>).some(
    (key) => state[key] !== previous[key]
  );
  return { state, changed, progressChanged };
}

export type SavedFilter = 'to-watch' | 'in-progress' | 'complete' | 'dropped';
export function trackingFilter(state: TrackingProjection): SavedFilter {
  const status = lifecycle({
    completed: state.watched,
    dropped: state.dropped,
    planned: state.watchlist,
    progress:
      state.positionSeconds > 0
        ? { unit: 'seconds', value: state.positionSeconds }
        : { unit: 'episodes', value: state.completedEpisodes },
  });
  return status === 'completed'
    ? 'complete'
    : status === 'dropped'
      ? 'dropped'
      : status === 'in-progress'
        ? 'in-progress'
        : 'to-watch';
}
/** Saved intent survives progress; ordinary watchlist removes completed movies / started shows. */
export function isUnstartedWatchlist(state: TrackingProjection, kind: string): boolean {
  return (
    state.watchlist &&
    !state.dropped &&
    !state.watched &&
    ((kind !== 'show' && kind !== 'season') || state.completedEpisodes === 0)
  );
}
export interface EpisodeProgress {
  mediaId: string;
  seasonNumber: number;
  episodeNumber: number;
  isSpecial: boolean;
  watched: boolean;
}
export function episodeOrderWarning(
  episodes: EpisodeProgress[],
  targetId: string,
  action: 'watch' | 'unwatch'
): string | null {
  const regular = episodes
    .filter((e) => !e.isSpecial)
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  const at = regular.findIndex((e) => e.mediaId === targetId);
  if (at < 0) return null;
  if (action === 'watch' && !regular[at].watched && regular.slice(0, at).some((e) => !e.watched))
    return 'Earlier episodes are still unwatched. Mark this episode watched anyway?';
  if (action === 'unwatch' && regular[at].watched && regular.slice(at + 1).some((e) => e.watched))
    return 'Later episodes are already watched. Mark this earlier episode unwatched anyway?';
  return null;
}
