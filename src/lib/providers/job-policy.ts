import type { RequestPriority } from '$lib/server/security/request-priority';

export const jobPurposes = ['playback', 'interactive', 'bootstrap', 'manual', 'live', 'scheduled'] as const;
export type JobPurpose = typeof jobPurposes[number];

/** Scheduling scope does not determine whose work a job represents. */
export function jobIdentityScope(kind: string): 'account' | 'instance' {
  return ['jellyfin.library', 'jellyfin.streams', 'jellyfin.updates', 'tmdb.refresh', 'tmdb.recommendations', 'igdb.recommendations', 'igdb.steam-metadata'].includes(kind)
    ? 'instance' : 'account';
}

export function purposePriority(purpose: JobPurpose): RequestPriority {
  return purpose === 'playback' || purpose === 'bootstrap' ? 0
    : purpose === 'interactive' || purpose === 'manual' ? 1 : purpose === 'live' ? 2 : 3;
}

export function readJobPurpose(payload: Record<string, unknown>, fallback: JobPurpose): JobPurpose {
  return jobPurposes.includes(payload._jobPurpose as JobPurpose) ? payload._jobPurpose as JobPurpose : fallback;
}

export function promotedPurpose(current: JobPurpose, requested: JobPurpose): JobPurpose {
  return purposePriority(requested) < purposePriority(current) ? requested : current;
}
