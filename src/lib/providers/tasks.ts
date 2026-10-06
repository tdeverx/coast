import type { ProviderSchedule } from './schedule';
export const maintenanceKinds = [
  'taste.refresh',
  'catalogue.user-scan',
  'tmdb.refresh',
  'tmdb.recommendations','igdb.recommendations','trakt.recommendations',
  'jellyfin.library',
  'jellyfin.sync',
  'trakt.live',
  'jellyfin.live',
  'jellyfin.streams',
  'steam.live',
  'trakt.import',
  'trakt.lists-import',
  'trakt.collection-project',
  'seerr.sync',
  'steam.sync',
  'steam.achievements',
];
// Cleanup/review traverse remote collections too, but retain per-preview/per-work
// queue identities rather than maintenance's one-job-per-kind deduplication.
export const serviceTraversalKinds=[...maintenanceKinds,'trakt.collection-cleanup','trakt.collection-review'];
export type ServiceTask = {
  id: string;
  title: string;
  description: string;
  kinds: string[];
  scope?: 'library' | 'users' | 'tracking' | 'lists' | 'live' | 'streams' | 'catalogue' | 'metadata' | 'all';
  interval?: 'intervalMinutes' | 'userIntervalMinutes' | 'listsIntervalMinutes' | 'liveIdleMinutes' | 'streamsIntervalMinutes' | 'catalogueIntervalMinutes' | 'recommendationsIntervalMinutes';
  enabled?: keyof ProviderSchedule;
};
function groupedServiceTasks(provider: string): ServiceTask[] {
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
  const recommendations:ServiceTask={id:'recommendations',title:'Recommendations',description:'Cache provider suggestions for For You. Metadata only; no personal tracking changes.',kinds:[`${provider}.recommendations`],scope:provider==='trakt'?'tracking':'metadata',interval:'recommendationsIntervalMinutes',enabled:'recommendationsEnabled'};
  if(provider==='igdb')return [recommendations];
  if (provider === 'tmdb') return [recommendations,{ id: 'metadata', title: 'Shared metadata refresh', description: 'Refresh existing shared TMDB records in bounded batches. Each title retries independently.', kinds: ['tmdb.refresh'], scope: 'metadata', interval: 'intervalMinutes' }];
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
      {id:'live',title:'Live activity',description:'Read this account’s current Jellyfin playback sessions.',kinds:['jellyfin.live'],scope:'live',interval:'liveIdleMinutes',enabled:'liveEnabled'},
      {id:'streams',title:'Server streams',description:'Record server streaming sessions and cache active stream counts using a Jellyfin administrator account.',kinds:['jellyfin.streams'],scope:'streams',interval:'streamsIntervalMinutes',enabled:'streamsEnabled'},
      catalogue,
      changes,
    ];
  if (provider === 'trakt')
    return [recommendations,
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
  if (provider === 'steam')return [
    {id:'live',title:'Live activity',description:'Read the current game when Steam account privacy permits it.',kinds:['steam.live'],scope:'live',interval:'liveIdleMinutes',enabled:'liveEnabled'},
    {id:'tracking',title:'Owned games & playtime',description:'Import owned Steam games and cumulative playtime. Ownership does not establish installation.',kinds:['steam.sync'],scope:'tracking',interval:'intervalMinutes',enabled:'trackingEnabled'},
    {id:'users',title:'Game achievements',description:'Refresh achievement progress for up to 20 owned games per run. Failed titles retain previous progress.',kinds:['steam.achievements'],scope:'users',interval:'userIntervalMinutes',enabled:'userSyncEnabled'},
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

/** One card describes one outbox job kind; shared schedule fields remain shared. */
export function serviceTasks(provider: string): ServiceTask[] {
  const titles: Record<string, string> = {
    'trakt.import': 'Tracking imports', 'trakt.collection-project': 'Collection export',
    'jellyfin.user-state': 'Tracking delivery', 'jellyfin.reconcile': 'Tracking reconciliation',
    'jellyfin.scrobble': 'Playback reports', 'history.remove': 'History removal',
    'trakt.checkin': 'Check-in delivery', 'trakt.export': 'Tracking delivery',
    'trakt.collection-cleanup': 'Collection cleanup', 'trakt.collection-review': 'Collection review',
    'trakt.progress': 'Progress delivery', 'trakt.scrobble': 'Playback reports',
    'trakt.list-export': 'List delivery', 'trakt.list-delete': 'List removal',
    'seerr.request': 'Request delivery', 'seerr.manage': 'Request management',
  };
  return groupedServiceTasks(provider).flatMap(task => task.kinds.length <= 1 ? [task] : task.kinds.map(kind => ({
    ...task, id: kind, title: titles[kind] ?? task.title, kinds: [kind],
    description: kind === 'trakt.import' ? 'Import the tracking categories selected by each connected account.' : kind === 'trakt.collection-project' ? 'Export each account’s opted-in Collection projection.' : task.description,
  })));
}
