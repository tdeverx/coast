/** Shared labels, navigation order and access classification for settings. */
export const personalSettings = [
  ['features', 'Features'],
  ['appearance', 'Appearance'],
  ['playback', 'Playback'],
  ['collection', 'Collection'],
  ['privacy','Privacy & social'],
  ['account', 'Account'],
  ['api', 'API access'],
  ['connections', 'Connections'],
  ['pending', 'Sync conflicts'],
] as const;
export const administratorSettings = [
  ['admin', 'Overview'],
  ['integrations', 'Integrations'],
  ['jobs', 'Jobs & schedules'],
  ['benchmarks', 'Benchmarking'],
  ['backups', 'Backups'],
  ['users', 'Accounts'],
  ['features-policy', 'Feature permissions'],
  ['policies', 'Policies'],
  ['activity', 'Activity & diagnostics'],
] as const;
export const settingsSections = [...personalSettings, ...administratorSettings];
export const settingsTitles: Record<string, string> = Object.fromEntries(settingsSections);
export type SettingsSection = (typeof settingsSections)[number][0];

export const settingsDescriptions: Record<string, string> = {
  features: 'Choose the optional features you use. Turning one off preserves your data and stops affected use at the next safe boundary.',
  'features-policy': 'Choose which features each account can use and manage their current preferences.',
  appearance: 'Choose how Coast displays your library and optional notifications.',
  collection: 'Choose what automatically appears in your Collection for each medium. History and relationships are preserved.',
  playback: 'Set subtitle and music listening preferences for your next playback session.',
  privacy:'Choose who can see your profile and activity, and which social notifications you receive.',
  api: 'Create scoped tokens for your applications and webhook subscriptions. Tokens are shown once and can be revoked.',
  account: 'Review your account, change your password and restore preferences.',
  connections: 'Link your personal service accounts and choose what they sync.',
  pending: 'Review conflicting changes before they replace your saved tracking data.',
  admin: 'Check installation health and work that needs your attention.',
  integrations: 'Configure shared services. Each user links their own account separately.',
  jobs: 'Manage automatic schedules and review background work across accounts.',
  backups: 'Schedule encrypted snapshots of Coast’s database and app files, and review the latest backup.',
  benchmarks: 'Run bounded local performance checks and review recorded results over time.',
  users: 'Create Coast accounts and review their linked services.',
  policies: 'Set installation-wide rules and defaults for everyone using Coast.',
  activity: 'Control runtime logging and review recent diagnostics and audit activity.',
};

export const preferenceFields = {
  features: ['features'],
  collection: ['collection'],
  privacy:['social'],
  appearance: ['shareDemand', 'fullWidth', 'liquidGlass', 'originalTitles', 'monochromeMissing', 'sanitizeOddReadingPages', 'region', 'notificationLevel'],
  playback: ['listenThreshold', 'subtitlesAlways', 'subtitleLanguages', 'subtitlePrompt'],
  connections: ['syncConflictWinner'],
} as const;

export const policySegments = [
  { value: 'access', label: 'Access', groups: ['access', 'sessions'] },
  { value: 'media', label: 'Media', groups: ['playback-policy', 'metadata'] },
  { value: 'system', label: 'System', groups: ['development', 'network', 'notifications'] },
] as const;

export function policySegmentForGroup(group: string) {
  return policySegments.find(segment => (segment.groups as readonly string[]).includes(group))?.value ?? 'access';
}

export const policyFields = [
  'developerMode',
  'siteAccess',
  'registrationMode',
  'registrationProvider',
  'sessionLifetimeDays',
  'playbackDelivery',
  'maxBitrateMbps',
  'allowTranscoding',
  'allowVrchatHevc',
  'vrchatViewerIdleMinutes',
  'subtitleDefault',
  'subtitleLanguages',
  'metadataSource',
  'cacheTmdbArtwork',
  'cacheServerArtwork',
  'enableTrakt',
  'allowedProviderPorts',
  'serverAllowlist',
  'notificationLevel',
  'allowNotificationSilencing',
] as const;

export function selectSettings<T extends object>(settings: T, keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, settings[key as keyof T]]));
}
