import type { ProviderSchedule } from './schedule';
export const maintenanceKinds = [
  'catalogue.user-scan',
  'tmdb.refresh',
  'jellyfin.library',
  'jellyfin.sync',
  'trakt.live',
  'trakt.import',
  'trakt.lists-import',
  'trakt.collection-project',
  'seerr.sync',
];
// Cleanup/review traverse remote collections too, but retain per-preview/per-work
// queue identities rather than maintenance's one-job-per-kind deduplication.
export const serviceTraversalKinds=[...maintenanceKinds,'trakt.collection-cleanup','trakt.collection-review'];
export type ServiceTask = {
  id: string;
  title: string;
  description: string;
  kinds: string[];
  scope?: 'library' | 'users' | 'tracking' | 'lists' | 'live' | 'catalogue' | 'metadata' | 'all';
  interval?: 'intervalMinutes' | 'userIntervalMinutes' | 'listsIntervalMinutes' | 'liveIdleMinutes' | 'catalogueIntervalMinutes';
  enabled?: keyof ProviderSchedule;
};
export function serviceTasks(provider: string): ServiceTask[] {
  const changes: ServiceTask = {
    id: 'changes',
    title: 'Changes & playback',
    description:
      'Tracking changes, requests and playback reports are delivered when you use Coast.',
    kinds:
      provider === 'jellyfin'
        ? ['jellyfin.user-state', 'jellyfin.reconcile', 'jellyfin.scrobble', 'history.remove']
        : provider === 'trakt'
          ? [
              'trakt.checkin',
              'trakt.export',
              'trakt.collection-cleanup',
              'trakt.collection-review',
              'trakt.progress',
              'trakt.scrobble',
              'trakt.list-export',
              'trakt.list-delete',
              'history.remove',
            ]
          : ['seerr.request', 'seerr.manage'],
  };
  const catalogue: ServiceTask = { id: 'catalogue', title: 'User catalogue', description: 'Add missing shared TMDB titles directly referenced by connected accounts. No recommendations or personal tracking changes.', kinds: ['catalogue.user-scan'], scope: 'catalogue', interval: 'catalogueIntervalMinutes', enabled: 'catalogueEnabled' };
  if (provider === 'tmdb') return [{ id: 'metadata', title: 'Shared metadata refresh', description: 'Refresh existing shared TMDB records in bounded batches. Each title retries independently.', kinds: ['tmdb.refresh'], scope: 'metadata', interval: 'intervalMinutes' }];
  if (provider === 'jellyfin')
    return [
      {
        id: 'library',
        title: 'Shared library',
        description:
          'One metadata scan for this service. New users do not start another library scan.',
        kinds: ['jellyfin.library'],
        scope: 'library',
        interval: 'intervalMinutes',
        enabled: 'libraryEnabled',
      },
      {
        id: 'users',
        title: 'User activity',
        description:
          'Access, watched history, favourites and resume positions. Accounts sync one at a time.',
        kinds: ['jellyfin.sync'],
        scope: 'users',
        interval: 'userIntervalMinutes',
        enabled: 'userSyncEnabled',
      },
      catalogue,
      changes,
    ];
  if (provider === 'trakt')
    return [
      {
        id:'live',title:'Live activity',description:'Read watching activity while idle or active. Outbound check-ins use each account’s scrobble preference.',kinds:['trakt.live'],scope:'live',interval:'liveIdleMinutes',enabled:'liveEnabled',
      },
      {
        id: 'tracking',
        title: 'Tracking & Collection',
        description:
          'Selected tracking imports and opted-in Collection exports for each account.',
        kinds: ['trakt.import', 'trakt.collection-project'],
        scope: 'tracking',
        interval: 'intervalMinutes',
        enabled: 'trackingEnabled',
      },
      {
        id: 'lists',
        title: 'List imports',
        description:
          'Names, membership and ordering. List retries run separately from tracking imports.',
        kinds: ['trakt.lists-import'],
        scope: 'lists',
        interval: 'listsIntervalMinutes',
        enabled: 'listsEnabled',
      },
      catalogue,
      changes,
    ];
  if (provider === 'seerr')
    return [
      {
        id: 'requests',
        title: 'Request status',
        description:
          'Refreshes each account’s requests and confirms removals without assuming a missing request was cancelled.',
        kinds: ['seerr.sync'],
        scope: 'all',
        interval: 'intervalMinutes',
      },
      { ...changes, title: 'Request delivery' },
    ];
  return [
    {
      id: 'metadata',
      title: 'Metadata',
      description:
        provider === 'igdb'
          ? 'Game metadata is fetched when needed and cached. No recurring account scan is required.'
          : 'Movie and show metadata is fetched when needed and cached. No recurring account scan is required.',
      kinds: [],
    },
  ];
}
