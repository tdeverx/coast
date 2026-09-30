/** Shared labels, navigation order and access classification for settings. */
export const personalSettings = [
  ['appearance', 'Appearance'],
  ['playback', 'Playback'],
  ['account', 'Account'],
  ['connections', 'Connections'],
  ['pending', 'Sync conflicts'],
] as const;
export const administratorSettings = [
  ['jobs', 'Jobs & schedules'],
  ['admin', 'Overview'],
  ['integrations', 'Integrations'],
  ['users', 'Accounts'],
  ['policies', 'Policies'],
  ['activity', 'Activity & diagnostics'],
] as const;
export const settingsSections = [...personalSettings, ...administratorSettings];
export const settingsTitles: Record<string, string> = Object.fromEntries(settingsSections);
