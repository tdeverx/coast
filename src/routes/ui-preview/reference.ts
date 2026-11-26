
/** Explicit reference ownership, not a second production component registry. */
export type ReferenceFamily = 'catalogue' | 'social' | 'admin' | 'feature' | 'production' | 'settings';
export type ReferenceCategory = 'elements' | 'components' | 'compositions';
export type ReferenceRecipe = {
  category: ReferenceCategory;
  id: string;
  title: string;
  family: ReferenceFamily;
  example: string;
  sources: string[];
  scenarios: string[];
};

export const referenceRecipes: ReferenceRecipe[] = [
  { id:'account.surface', category:'elements', title:'Glass field surface', family:'production', example:'account.surface', sources:['src/lib/auth/ui/AuthSurface.svelte'], scenarios:['group','invite','expandable','anchor'] },
  { id:'account.identity', category:'components', title:'Account identity row', family:'production', example:'account.identity', sources:['src/lib/auth/ui/AccountIdentity.svelte'], scenarios:['initials','artwork','status'] },
  { id:'onboarding.panels', category:'components', title:'Segment panels', family:'production', example:'onboarding.panels', sources:['src/lib/auth/ui/SegmentPanels.svelte'], scenarios:['horizontal','vertical'] },
  { id: 'settings.sidebar', category: 'compositions', title: 'Settings sidebar', family: 'settings', example: 'settings.sidebar', sources: ['src/lib/settings/SettingsSidebar.svelte', 'src/lib/settings/SettingsOverview.svelte'], scenarios: ['personal', 'admin'] },
  { id: 'admin.invites', category: 'compositions', title: 'Invitations', family: 'settings', example: 'admin.invites', sources: ['src/lib/auth/ui/AdminInviteSettings.svelte', 'src/lib/settings/redesign/AdminInviteSettings.svelte'], scenarios: ['invitations', 'defaults', 'sidebar-invitations', 'sidebar-defaults'] },
  { id: 'admin.member', category: 'compositions', title: 'Member access', family: 'settings', example: 'admin.member', sources: ['src/lib/auth/ui/AccountAccessControls.svelte', 'src/lib/settings/redesign/AccountAccessControls.svelte'], scenarios: ['account', 'bulk', 'sidebar-account', 'sidebar-bulk'] },
  { id: 'admin.permissions', category: 'components', title: 'Feature permissions', family: 'settings', example: 'admin.permissions', sources: ['src/lib/settings/MemberFeaturePermissions.svelte'], scenarios: ['classic', 'sidebar'] },
  { id: 'admin.demand', category: 'compositions', title: 'Missing demand', family: 'settings', example: 'admin.demand', sources: ['src/lib/settings/AdminDemand.svelte'], scenarios: ['normal', 'empty'] },
  { id: 'account.invites', category: 'compositions', title: 'Member invitations', family: 'settings', example: 'account.invites', sources: ['src/lib/auth/ui/MemberInvites.svelte'], scenarios: ['member-invites'] },
  { id: 'settings.connection', category: 'compositions', title: 'ConnectionCard', family: 'settings', example: 'settings.connection', sources: ['src/lib/settings/redesign/ConnectionCard.svelte'], scenarios: ['sidebar'] },
  { id: 'settings.projection', category: 'compositions', title: 'CollectionProjectionSettings', family: 'settings', example: 'settings.projection', sources: ['src/lib/settings/redesign/CollectionProjectionSettings.svelte'], scenarios: ['sidebar'] },
  { id: 'settings.integration', category: 'compositions', title: 'IntegrationSettings', family: 'settings', example: 'settings.integration', sources: ['src/lib/settings/redesign/IntegrationSettings.svelte'], scenarios: ['sidebar'] },
  { id: 'settings.automation', category: 'compositions', title: 'ProviderAutomation', family: 'settings', example: 'settings.automation', sources: ['src/lib/settings/redesign/ProviderAutomation.svelte'], scenarios: ['sidebar'] },
  { id: 'editor.picker', category: 'components', title: 'Option picker', family: 'production', example: 'editor.picker', sources: ['src/lib/ui/cards/editor/PreviewSelect.svelte'], scenarios: ['pinned', 'centered', 'inline-value', 'disabled'] },
  { id: 'editor.disclosure', category: 'components', title: 'Disclosure row', family: 'production', example: 'editor.disclosure', sources: ['src/lib/ui/cards/editor/PreviewDisclosure.svelte'], scenarios: ['group'] },
  { id: 'editor.separator', category: 'elements', title: 'Glass separator', family: 'production', example: 'editor.separator', sources: ['src/lib/auth/ui/GlassSeparator.svelte'], scenarios: ['default'] },
  { id: 'editor.toggle', category: 'elements', title: 'Toggle row', family: 'production', example: 'editor.toggle', sources: ['src/lib/ui/cards/editor/PreviewToggle.svelte'], scenarios: ['toggle-row'] },
  { id: 'editor.value', category: 'elements', title: 'Inline value field', family: 'production', example: 'editor.value', sources: ['src/lib/ui/cards/editor/PreviewValueInput.svelte'], scenarios: ['inline-value'] },
  { id: 'editor.carousel', category: 'components', title: 'Section carousel', family: 'production', example: 'editor.carousel', sources: ['src/lib/ui/cards/editor/SettingsCarousel.svelte', 'src/lib/ui/cards/editor/SettingsPanels.svelte'], scenarios: ['carousel'] },
  { id: 'editor.personalise', category: 'compositions', title: 'Personalise', family: 'production', example: 'editor.personalise', sources: ['src/lib/ui/cards/editor/CardLayoutEditor.svelte'], scenarios: ['editor'] },
  { id: 'onboarding.services', category: 'compositions', title: 'Onboarding services', family: 'production', example: 'onboarding.services', sources: ['src/lib/auth/ui/ServiceHeader.svelte', 'src/lib/auth/ui/ServiceDisclosure.svelte', 'src/lib/auth/ui/JellyfinFields.svelte', 'src/lib/providers/trakt/PairingCode.svelte', 'src/lib/providers/trakt/AccessFields.svelte', 'src/lib/auth/ui/ProfileFields.svelte'], scenarios: ['jellyfin', 'trakt-pairing', 'trakt-permissions', 'profile-fields'] },
  { id: 'onboarding.import', category: 'components', title: 'Import status row', family: 'production', example: 'onboarding.import', sources: ['src/lib/auth/ui/ImportRow.svelte'], scenarios: ['importing', 'queued', 'completed'] },
  { id:'catalogue.progress', category: 'compositions',title:'Mixed-media Progress',family:'catalogue',example:'progress-experiment',sources:['src/lib/ui/components/Shelf.svelte','src/lib/ui/mixed-card.ts','src/lib/ui/shelves/progress-experiment.svelte.ts','src/routes/progress-experiment/+page.svelte'],scenarios:['settled','loading','empty','refresh'] },
  { id: 'catalogue.cards', category: 'components', title: 'Media card variants', family: 'catalogue', example: 'media-cards', sources: ['src/lib/ui/components/MediaCard.svelte', 'src/lib/ui/cards/editor/CardLayoutEditor.svelte'], scenarios: ['movie', 'show', 'season', 'episode', 'collection', 'game', 'album', 'track', 'artist', 'book', 'comic', 'person', 'available', 'unavailable', 'missing-art', 'broken-art', 'long-copy', 'rating', 'match', 'for-you', 'collection-match'] },
  { id: 'catalogue.rows', category: 'compositions', title: 'Row loading and feedback', family: 'catalogue', example: 'shelf-states', sources: ['src/lib/ui/components/Shelf.svelte'], scenarios: ['loading', 'empty', 'error', 'refresh', 'settled'] },
  { id: 'catalogue.details', category: 'compositions', title: 'Media detail compositions', family: 'catalogue', example: 'media-details', sources: ['src/lib/reading/GroupDetails.svelte', 'src/lib/media/Details.svelte', 'src/lib/media/DetailRows.svelte', 'src/lib/reading/Details.svelte', 'src/lib/games/Details.svelte', 'src/lib/games/RemoteDetails.svelte', 'src/lib/music/Details.svelte', 'src/lib/ui/pages/music.svelte.ts'], scenarios: ['movie', 'show', 'season', 'episode', 'collection', 'music', 'game', 'game-remote', 'book', 'comic', 'remote-reading', 'reading-collection'] },
  { id: 'reading.launch', category: 'components', title: 'Direct reading action', family: 'catalogue', example: 'reading-launch', sources: ['src/lib/reading/ReadingLaunch.svelte'], scenarios: ['available'] },
  { id: 'reading.reader', category: 'compositions', title: 'Reader', family: 'catalogue', example: 'reader', sources: ['src/lib/reading/Reader.svelte'], scenarios: ['ready', 'opening', 'error', 'unsaved', 'follower'] },
  { id: 'people.intro', category: 'compositions', title: 'Person biography', family: 'catalogue', example: 'person-intro', sources: ['src/lib/media/PersonDetails.svelte','src/routes/people/[id]/+page.svelte'], scenarios: ['complete', 'missing-art', 'long-bio'] },
  { id: 'search.form', category: 'compositions', title: 'Search forms', family: 'catalogue', example: 'search-pattern', sources: ['src/routes/search/+page.svelte', 'src/routes/music/+page.svelte', 'src/routes/games/+page.svelte'], scenarios: ['idle', 'results', 'error'] },
  { id: 'catalogue.status', category: 'compositions', title: 'Edition, request and availability', family: 'catalogue', example: 'status-patterns', sources: ['src/lib/media/Details.svelte', 'src/routes/library/+page.svelte'], scenarios: ['request', 'edition', 'missing-demand'] },
  { id: 'catalogue.history', category: 'compositions', title: 'History and selection', family: 'catalogue', example: 'history-patterns', sources: ['src/lib/games/Details.svelte', 'src/lib/reading/Details.svelte', 'src/routes/media/[id]/history/+page.svelte'], scenarios: ['game-table', 'reading', 'selection'] },
  { id: 'account.auth', category: 'compositions', title: 'Account forms', family: 'admin', example: 'auth', sources: ['src/lib/auth/ui/AccountAccess.svelte','src/lib/auth/ui/AccountIdentity.svelte','src/lib/auth/ui/InviterField.svelte','src/lib/auth/ui/InviteCodeField.svelte','src/lib/auth/ui/LoginBackdrop.svelte','src/lib/auth/ui/AuthSurface.svelte','src/lib/auth/ui/ProfileFields.svelte','src/lib/auth/ui/SegmentPanels.svelte','src/lib/auth/ui/ServiceHeader.svelte','src/lib/auth/ui/ServiceDisclosure.svelte','src/lib/auth/ui/JellyfinFields.svelte','src/routes/onboarding/Services.svelte','src/routes/login/+page.svelte', 'src/routes/register/+page.svelte', 'src/routes/invite/+page.svelte', 'src/routes/setup/+page.svelte', 'src/routes/onboarding/+page.svelte'], scenarios: ['login', 'register', 'invite', 'verified-invite', 'setup', 'password', 'error'] },
  { id: 'settings.rows', category: 'compositions', title: 'Settings rows and save states', family: 'admin', example: 'settings', sources: ['src/routes/settings/[[section]]/+page.svelte', 'src/lib/settings/ClassicSettings.svelte', 'src/lib/settings/redesign/SettingsEditor.svelte'], scenarios: ['normal', 'unavailable', 'saving', 'error'] },
  { id: 'settings.progress', category: 'components', title: 'Operational progress', family: 'admin', example: 'operational-progress', sources: ['src/lib/ui/components/ConnectionCard.svelte','src/lib/auth/ui/ImportRow.svelte','src/routes/onboarding/+page.svelte'], scenarios: ['known', 'unknown', 'waiting', 'complete', 'error', 'empty'] },
  { id: 'admin.table', category: 'compositions', title: 'Administrative tables', family: 'admin', example: 'admin-table', sources: ['src/lib/settings/AdminDemand.svelte', 'src/routes/settings/[[section]]/+page.svelte', 'src/lib/settings/ClassicSettings.svelte', 'src/lib/settings/redesign/SettingsEditor.svelte'], scenarios: ['normal', 'empty'] },
  { id: 'admin.diagnostics', category: 'compositions', title: 'Diagnostics and disclosure', family: 'admin', example: 'diagnostics', sources: ['src/routes/settings/[[section]]/+page.svelte', 'src/lib/settings/ClassicSettings.svelte', 'src/lib/settings/redesign/SettingsEditor.svelte'], scenarios: ['normal', 'empty'] },
  { id: 'account.secret', category: 'components', title: 'One-time output', family: 'admin', example: 'secret-output', sources: ['src/routes/settings/[[section]]/+page.svelte', 'src/lib/settings/ClassicSettings.svelte', 'src/lib/settings/redesign/SettingsEditor.svelte'], scenarios: ['token', 'invite', 'hidden'] },
  { id: 'admin.backups', category: 'compositions', title: 'Backups and schedules', family: 'admin', example: 'backups', sources: ['src/lib/backups/BackupSettings.svelte'], scenarios: ['completed', 'running', 'failed', 'unavailable'] },
  { id: 'admin.benchmark', category: 'compositions', title: 'Benchmark results', family: 'admin', example: 'benchmark', sources: ['src/lib/benchmarks/BenchmarkSettings.svelte'], scenarios: ['complete', 'empty', 'running', 'error'] },
  { id: 'profile.identity', category: 'compositions', title: 'Profile identity', family: 'feature', example: 'profile.identity', sources: ['src/lib/profile/Details.svelte'], scenarios: ['self', 'other', 'private', 'no-art', 'long', 'taste', 'lists'] },
  { id: 'profile.insights', category: 'compositions', title: 'Profile and taste insights', family: 'feature', example: 'profile.insights', sources: ['src/lib/profile/TasteComparison.svelte'], scenarios: ['activity', 'taste', 'unknown'] },
  { id: 'pages.browse', category: 'compositions', title: 'Browse page compositions', family: 'feature', example: 'pages.browse', sources: ['src/routes/for-you/+page.svelte', 'src/routes/discover/+page.svelte', 'src/routes/search/+page.svelte', 'src/routes/library/+page.svelte', 'src/routes/progress/+page.svelte', 'src/routes/lists/+page.svelte', 'src/routes/music/+page.svelte', 'src/routes/games/+page.svelte', 'src/routes/planning/+page.svelte'], scenarios: ['for-you', 'discover', 'search', 'library', 'progress', 'lists', 'music', 'games', 'planning', 'empty'] },
  { id: 'recommendations.dynamic', category: 'compositions', title: 'Dynamic recommendations', family: 'feature', example: 'recommendations.dynamic', sources: ['src/lib/recommendations/DynamicFeed.svelte'], scenarios: ['rows', 'empty', 'error'] },
  { id: 'planning.action', category: 'compositions', title: 'Planning dialog', family: 'feature', example: 'planning.action', sources: ['src/lib/planning/PlanAction.svelte'], scenarios: ['normal', 'error'] },
  { id: 'sharing.action', category: 'compositions', title: 'Sharing dialog', family: 'feature', example: 'sharing.action', sources: ['src/lib/sharing/ShareAction.svelte'], scenarios: ['normal', 'reading', 'empty', 'error'] },
  { id: 'sharing.landing', category: 'compositions', title: 'Shared links and party landing', family: 'feature', example: 'sharing.landing', sources: ['src/routes/share/+page.svelte', 'src/routes/synced/[id]/+page.svelte'], scenarios: ['invitation', 'party', 'error', 'expired'] },
  { id: 'media.details', category: 'compositions', title: 'Media detail overlay', family: 'feature', example: 'media.details', sources: ['src/lib/media/DetailPanel.svelte','src/lib/ui/pages/SectionDetails.svelte'], scenarios: ['screen', 'reading', 'editions', 'nested','section','row', 'error'] },
  { id: 'app.shell', category: 'compositions', title: 'Application shell', family: 'feature', example: 'app.shell', sources: ['src/routes/+layout.svelte', 'src/routes/+error.svelte'], scenarios: ['member', 'guest', 'error'] },
  { id: 'ui.native', category: 'elements', title: 'Styled native elements', family: 'feature', example: 'ui.native', sources: ['src/app.css'], scenarios: ['inputs', 'notices', 'badges', 'disclosure', 'skeletons'] },
  { id: 'foundation.controls', category: 'elements', title: 'Control sizes and surface roles', family: 'feature', example: 'foundation.controls', sources: ['src/app.css', 'src/lib/ui/components/Button.svelte'], scenarios: ['sizes', 'focus', 'motion', 'surfaces'] },
];

export const componentScenarios: Record<string, string[]> = {
  FriendsPanel: ['friends', 'requests', 'parties', 'active-party', 'loading', 'empty', 'error'],
  FriendRoster: ['accepted', 'pending', 'activity', 'long', 'empty', 'busy'],
  PartyCard: ['joined', 'invite', 'rejoin', 'idle', 'music', 'reading', 'embedded', 'many', 'pending', 'buffering', 'follower', 'unavailable', 'disconnected'],
  PersistentPlayer: ['controller', 'paused', 'playing', 'audio', 'follower', 'error', 'postplay', 'hidden'],
  WorkMenu: ['episode', 'season', 'show', 'movie', 'collection', 'book', 'comic', 'game', 'track', 'album', 'artist', 'pending', 'list-entry'],
  PartyMenu: ['host', 'member', 'music', 'reading', 'buffering', 'queue'],
  PlaybackTimeline: ['seekable', 'passive', 'audio', 'reading', 'unknown', 'long'],
  NotificationInbox: ['all', 'unread', 'attachments', 'read', 'locked', 'loading', 'empty', 'error'],
  NotificationToasts: ['normal', 'persistent', 'multiple', 'long'],
  StreamsPanel: ['now', 'history', 'shared', 'links', 'issues', 'loading', 'empty', 'error'],
  ConnectionCard: ['connected', 'disconnected', 'error'],
  AvatarPicker: ['upload', 'connected', 'error'],
  Field: ['text', 'select', 'file', 'range', 'checkbox', 'invalid'],
  Button: ['default', 'disabled', 'pressed', 'busy'],
  Dialog: ['default', 'long'],
  MediaHero: ['movie', 'show', 'collection', 'missing-art'],
  RequestDialog: ['empty', 'movie', 'show', 'four-k'],
  Toast: ['success','error'],
  OperationProgress: ['known','unknown','complete','zero'],
  ProgressiveBlur: ['neutral', 'tinted', 'gradient-only'],
  SettingsRow: ['normal','unavailable'],
};

export function recipe(id: string) { return referenceRecipes.find(item => item.id === id); }
export function scenarios(id: string) { return recipe(id)?.scenarios ?? componentScenarios[id] ?? ['default']; }
export function scenarioLabel(value: string) { return value.replace(/-/g, ' ').replace(/^./, letter => letter.toUpperCase()); }
export type ApprovalStatus='unapproved'|'approved';
const approvals: Readonly<Record<string, ApprovalStatus>> = {};
export function approvalStatus(id:string): ApprovalStatus { return approvals[id] ?? 'unapproved'; }

/** Dynamic owners are declarations only: reference browsing must not eagerly import them. */
export const dynamicOwners = {
  'src/routes/settings/[[section]]/+page.svelte': ['src/lib/settings/redesign/SettingsEditor.svelte'],
  'src/lib/settings/SettingsPanel.svelte': ['src/lib/settings/redesign/SettingsEditor.svelte'],
  'src/routes/+layout.svelte': ['src/lib/reading/Reader.svelte', 'src/lib/media/DetailPanel.svelte', 'src/lib/ui/components/NotificationInbox.svelte', 'src/lib/ui/components/FriendsPanel.svelte', 'src/lib/ui/components/StreamsPanel.svelte'],
  'src/routes/for-you/+page.svelte': ['src/lib/recommendations/DynamicFeed.svelte'],
};
