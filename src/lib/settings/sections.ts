/** Shared labels, navigation order and access classification for settings. */
export const personalSettings = [
  ['appearance', 'Appearance'],
  ['playback', 'Playback'],
  ['collection', 'Collection'],
  ['privacy','Privacy & social'],
  ['account', 'Account'],
  ['connections', 'Connections'],
  ['pending', 'Sync conflicts'],
] as const;
export const administratorSettings = [
  ['admin', 'Overview'],
  ['integrations', 'Integrations'],
  ['jobs', 'Jobs & schedules'],
  ['users', 'Accounts'],
  ['policies', 'Policies'],
  ['activity', 'Activity & diagnostics'],
] as const;
export const settingsSections = [...personalSettings, ...administratorSettings];
export const settingsTitles: Record<string, string> = Object.fromEntries(settingsSections);

export const settingsDescriptions: Record<string, string> = {
  appearance: 'Choose how Coast displays your library and optional notifications.',
  collection: 'Choose what automatically appears in your Collection for each medium. History and relationships are preserved.',
  playback: 'Set subtitle and music listening preferences for your next playback session.',
  privacy:'Choose who can see your profile and activity, and which social notifications you receive.',
  account: 'Review your account, change your password and restore preferences.',
  connections: 'Link your personal service accounts and choose what they sync.',
  pending: 'Review conflicting changes before they replace your saved tracking data.',
  admin: 'Check installation health and work that needs your attention.',
  integrations: 'Configure shared services. Each user links their own account separately.',
  jobs: 'Manage automatic schedules and review background work across accounts.',
  users: 'Create Coast accounts and review their linked services.',
  policies: 'Set installation-wide rules and defaults for everyone using Coast.',
  activity: 'Control runtime logging and review recent diagnostics and audit activity.',
};

export const preferenceFields = {
  collection: ['collection'],
  privacy:['social'],
  appearance: ['shareDemand', 'fullWidth', 'originalTitles', 'region', 'notificationsSilenced'],
  playback: ['listenThreshold', 'subtitlesAlways', 'subtitleLanguages', 'subtitlePrompt'],
  connections: ['syncConflictWinner'],
} as const;

export const policyGroups = [
  ['features', 'Experimental features'],
  ['sessions', 'Sessions'],
  ['playback-policy', 'Playback'],
  ['metadata', 'Metadata'],
  ['network', 'Integrations & network'],
  ['notifications', 'Notifications'],
] as const;

export const policyFields = [
  'siteAccess',
  'experimentalFeatures',
  'sessionLifetimeDays',
  'playbackDelivery',
  'maxBitrateMbps',
  'allowTranscoding',
  'subtitleDefault',
  'subtitleLanguages',
  'metadataSource',
  'cacheTmdbArtwork',
  'enableTrakt',
  'enableRequests',
  'allowedProviderPorts',
  'serverAllowlist',
  'notificationLevel',
  'allowNotificationSilencing',
] as const;

export function selectSettings<T extends object>(settings: T, keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, settings[key as keyof T]]));
}
