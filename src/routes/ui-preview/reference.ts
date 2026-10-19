/** Explicit reference ownership, not a second production component registry. */
export type ReferenceFamily = 'catalogue' | 'social' | 'admin' | 'feature';
export type ReferenceRecipe = {
  id: string;
  title: string;
  family: ReferenceFamily;
  example: string;
  sources: string[];
  scenarios: string[];
};

export const compositions: ReferenceRecipe[] = [
  { id: 'catalogue.cards', title: 'Media card variants', family: 'catalogue', example: 'media-cards', sources: ['src/lib/ui/components/MediaCard.svelte'], scenarios: ['movie', 'show', 'season', 'episode', 'game', 'album', 'track', 'artist', 'book', 'comic', 'person', 'available', 'unavailable', 'missing-art', 'broken-art', 'long-copy'] },
  { id: 'catalogue.rows', title: 'Row loading and feedback', family: 'catalogue', example: 'shelf-states', sources: ['src/lib/ui/components/Shelf.svelte'], scenarios: ['loading', 'empty', 'error', 'refresh', 'settled'] },
  { id: 'catalogue.details', title: 'Media detail compositions', family: 'catalogue', example: 'media-details', sources: ['src/lib/reading/GroupDetails.svelte', 'src/lib/media/Details.svelte', 'src/lib/media/DetailRows.svelte', 'src/lib/reading/Details.svelte', 'src/lib/games/Details.svelte', 'src/lib/games/RemoteDetails.svelte', 'src/lib/music/Details.svelte', 'src/lib/ui/pages/music.svelte.ts'], scenarios: ['movie', 'show', 'season', 'episode', 'collection', 'music', 'game', 'game-remote', 'book', 'comic', 'remote-reading', 'reading-collection'] },
  { id: 'reading.launch', title: 'Direct reading action', family: 'catalogue', example: 'reading-launch', sources: ['src/lib/reading/ReadingLaunch.svelte'], scenarios: ['available'] },
  { id: 'reading.reader', title: 'Reader', family: 'catalogue', example: 'reader', sources: ['src/lib/reading/Reader.svelte'], scenarios: ['ready', 'opening', 'error', 'unsaved', 'follower'] },
  { id: 'people.intro', title: 'Person biography', family: 'catalogue', example: 'person-intro', sources: ['src/lib/media/PersonDetails.svelte','src/routes/people/[id]/+page.svelte'], scenarios: ['complete', 'missing-art', 'long-bio'] },
  { id: 'search.form', title: 'Search forms', family: 'catalogue', example: 'search-pattern', sources: ['src/routes/search/+page.svelte', 'src/routes/music/+page.svelte', 'src/routes/games/+page.svelte'], scenarios: ['idle', 'results', 'error'] },
  { id: 'catalogue.status', title: 'Edition, request and availability', family: 'catalogue', example: 'status-patterns', sources: ['src/lib/media/Details.svelte', 'src/routes/requests/+page.svelte', 'src/routes/library/+page.svelte'], scenarios: ['request', 'edition', 'missing-demand'] },
  { id: 'catalogue.history', title: 'History and selection', family: 'catalogue', example: 'history-patterns', sources: ['src/lib/games/Details.svelte', 'src/lib/reading/Details.svelte', 'src/routes/media/[id]/history/+page.svelte'], scenarios: ['game-table', 'reading', 'selection'] },
  { id: 'account.auth', title: 'Account forms', family: 'admin', example: 'auth', sources: ['src/routes/login/+page.svelte', 'src/routes/register/+page.svelte', 'src/routes/setup/+page.svelte', 'src/routes/onboarding/+page.svelte'], scenarios: ['login', 'register', 'setup', 'password', 'error', 'busy'] },
  { id: 'settings.rows', title: 'Settings rows and save states', family: 'admin', example: 'settings', sources: ['src/routes/settings/[[section]]/+page.svelte'], scenarios: ['normal', 'unavailable', 'saving', 'error'] },
  { id: 'settings.progress', title: 'Operational progress', family: 'admin', example: 'operational-progress', sources: ['src/lib/ui/components/ConnectionCard.svelte', 'src/routes/onboarding/+page.svelte'], scenarios: ['known', 'unknown', 'waiting', 'complete', 'error', 'empty'] },
  { id: 'admin.table', title: 'Administrative tables', family: 'admin', example: 'admin-table', sources: ['src/routes/settings/[[section]]/+page.svelte'], scenarios: ['normal', 'empty'] },
  { id: 'admin.diagnostics', title: 'Diagnostics and disclosure', family: 'admin', example: 'diagnostics', sources: ['src/routes/settings/[[section]]/+page.svelte'], scenarios: ['normal', 'empty'] },
  { id: 'account.secret', title: 'One-time output', family: 'admin', example: 'secret-output', sources: ['src/routes/settings/[[section]]/+page.svelte'], scenarios: ['token', 'invite', 'hidden'] },
  { id: 'admin.benchmark', title: 'Benchmark results', family: 'admin', example: 'benchmark', sources: ['src/lib/benchmarks/BenchmarkSettings.svelte'], scenarios: ['complete', 'empty', 'running', 'error'] },
  { id: 'profile.identity', title: 'Profile identity', family: 'feature', example: 'profile.identity', sources: ['src/routes/profile/[username]/+page.svelte'], scenarios: ['self', 'other', 'private', 'no-art', 'long'] },
  { id: 'profile.insights', title: 'Profile and taste insights', family: 'feature', example: 'profile.insights', sources: ['src/routes/taste/[friendId]/+page.svelte'], scenarios: ['activity', 'taste', 'unknown'] },
  { id: 'pages.browse', title: 'Browse page compositions', family: 'feature', example: 'pages.browse', sources: ['src/routes/for-you/+page.svelte', 'src/routes/discover/+page.svelte', 'src/routes/search/+page.svelte', 'src/routes/library/+page.svelte', 'src/routes/progress/+page.svelte', 'src/routes/lists/+page.svelte', 'src/routes/music/+page.svelte', 'src/routes/games/+page.svelte', 'src/routes/planning/+page.svelte'], scenarios: ['for-you', 'discover', 'search', 'library', 'progress', 'lists', 'music', 'games', 'planning', 'empty'] },
  { id: 'recommendations.dynamic', title: 'Dynamic recommendations', family: 'feature', example: 'recommendations.dynamic', sources: ['src/lib/recommendations/DynamicFeed.svelte'], scenarios: ['rows', 'empty', 'error'] },
  { id: 'planning.action', title: 'Planning dialog', family: 'feature', example: 'planning.action', sources: ['src/lib/experiments/PlanAction.svelte'], scenarios: ['normal', 'error'] },
  { id: 'sharing.action', title: 'Sharing dialog', family: 'feature', example: 'sharing.action', sources: ['src/lib/sharing/ShareAction.svelte'], scenarios: ['normal', 'empty', 'error'] },
  { id: 'sharing.landing', title: 'Shared links and party landing', family: 'feature', example: 'sharing.landing', sources: ['src/routes/share/+page.svelte', 'src/routes/synced/[id]/+page.svelte'], scenarios: ['invitation', 'party', 'error', 'expired'] },
  { id: 'media.details', title: 'Media detail overlay', family: 'feature', example: 'media.details', sources: ['src/lib/media/DetailPanel.svelte','src/lib/ui/pages/SectionDetails.svelte'], scenarios: ['screen', 'reading', 'editions', 'nested','section','row', 'error'] },
  { id: 'app.shell', title: 'Application shell', family: 'feature', example: 'app.shell', sources: ['src/routes/+layout.svelte', 'src/routes/+error.svelte'], scenarios: ['member', 'guest', 'error'] },
  { id: 'ui.native', title: 'Styled native elements', family: 'feature', example: 'ui.native', sources: ['src/app.css'], scenarios: ['inputs', 'notices', 'badges', 'disclosure', 'skeletons'] },
  { id: 'foundation.controls', title: 'Control sizes and surface roles', family: 'feature', example: 'foundation.controls', sources: ['src/app.css', 'src/lib/ui/components/Button.svelte'], scenarios: ['sizes', 'focus', 'motion', 'surfaces'] },
];

export const componentScenarios: Record<string, string[]> = {
  FriendsPanel: ['friends', 'requests', 'parties', 'loading', 'empty', 'error'],
  FriendRoster: ['accepted', 'pending', 'activity', 'long', 'empty', 'busy'],
  PartyCard: ['joined', 'invite', 'rejoin', 'idle', 'music', 'reading', 'embedded', 'many', 'pending', 'buffering', 'follower', 'unavailable', 'disconnected'],
  PersistentPlayer: ['controller', 'paused', 'playing', 'audio', 'follower', 'error', 'postplay', 'hidden'],
  PartyMenu: ['host', 'member', 'music', 'reading', 'buffering', 'queue'],
  PlaybackTimeline: ['seekable', 'passive', 'audio', 'reading', 'unknown', 'long'],
  NotificationInbox: ['all', 'unread', 'attachments', 'read', 'locked', 'loading', 'empty', 'error'],
  NotificationToasts: ['normal', 'persistent', 'multiple', 'long'],
  StreamsPanel: ['now', 'history', 'shared', 'issues', 'loading', 'empty', 'error'],
  ConnectionCard: ['connected', 'disconnected', 'error'],
  AvatarPicker: ['upload', 'connected', 'error'],
  Field: ['text', 'select', 'file', 'range', 'checkbox', 'invalid'],
  Button: ['default', 'disabled', 'pressed', 'busy'],
  Dialog: ['default', 'long'],
  MediaHero: ['movie', 'show', 'collection', 'missing-art'],
  RequestDialog: ['empty', 'movie', 'show', 'four-k'],
  Toast: ['success','error'],
  OperationProgress: ['known','unknown','complete','zero'],
  SettingsRow: ['normal','unavailable'],
};

export function recipe(id: string) { return compositions.find(item => item.id === id); }
export function scenarios(id: string) { return recipe(id)?.scenarios ?? componentScenarios[id] ?? ['default']; }
export function selectedScenario(id: string, value?: string | null) {
  const options = scenarios(id);
  return value && options.includes(value) ? value : options[0];
}
export function scenarioLabel(value: string) { return value.replace(/-/g, ' ').replace(/^./, letter => letter.toUpperCase()); }
const nonApproved = new Set(['Button', 'SocialControls', 'NotificationInbox', 'StreamsPanel']);
export type ApprovalStatus='unknown'|'unapproved'|'approved';
export function approvalStatus(id:string):ApprovalStatus { return nonApproved.has(id)||id==='experiment'?'unapproved':'unknown'; }

/** Dynamic owners are declarations only: reference browsing must not eagerly import them. */
export const dynamicOwners = {
  'src/routes/+layout.svelte': ['src/lib/reading/Reader.svelte', 'src/lib/media/DetailPanel.svelte', 'src/lib/ui/components/NotificationInbox.svelte', 'src/lib/ui/components/FriendsPanel.svelte', 'src/lib/ui/components/StreamsPanel.svelte'],
  'src/routes/for-you/+page.svelte': ['src/lib/recommendations/DynamicFeed.svelte'],
};
