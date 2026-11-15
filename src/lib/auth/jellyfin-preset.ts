import * as v from 'valibot';

export const jellyfinUserId = v.pipe(v.string(), v.regex(/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i));
const ids = v.pipe(v.array(jellyfinUserId), v.maxLength(100));
const label = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200));
const nullableLabel = v.pipe(v.nullable(v.pipe(v.string(),v.trim(),v.maxLength(200))),v.transform(value=>value||null));
const integer = (min: number, max: number) => v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
const tags = v.pipe(v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80))), v.maxLength(30));
const hour = v.pipe(v.number(), v.minValue(0), v.maxValue(24));
export const scheduleDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Everyday', 'Weekday', 'Weekend'] as const;
export const unratedItems = ['Movie', 'Trailer', 'Series', 'Music', 'Book', 'LiveTvChannel', 'LiveTvProgram', 'ChannelContent', 'Other'] as const;
const schedule = v.pipe(v.strictObject({
  DayOfWeek: v.picklist(scheduleDays), StartHour: hour, EndHour: hour,
}), v.check(item => item.StartHour < item.EndHour, 'An access window must end after it starts.'));

export const jellyfinPlaybackFlags = {
  EnableMediaPlayback: 'Playback',
  EnableAudioPlaybackTranscoding: 'Audio transcoding',
  EnableVideoPlaybackTranscoding: 'Video transcoding',
  EnablePlaybackRemuxing: 'Remuxing',
  ForceRemoteSourceTranscoding: 'Force transcoding for remote media sources',
  EnableSyncTranscoding: 'Sync transcoding',
  EnableMediaConversion: 'Media conversion',
  EnableContentDownloading: 'Downloads',
} as const;

export const jellyfinPermissionFlags = {
  IsHidden: 'Hide from Jellyfin sign-in',
  EnableRemoteAccess: 'Remote access',
  EnableLiveTvAccess: 'Live TV',
  EnableLiveTvManagement: 'Manage Live TV recordings',
  EnableCollectionManagement: 'Manage collections',
  EnableSubtitleManagement: 'Manage subtitles',
  EnableLyricManagement: 'Manage lyrics',
  EnableUserPreferenceAccess: 'Edit Jellyfin preferences',
  EnableRemoteControlOfOtherUsers: 'Control other users’ sessions',
  EnableSharedDeviceControl: 'Control shared devices',
  EnablePublicSharing: 'Jellyfin public sharing',
} as const;

export const jellyfinPreferenceFlags = {
  PlayDefaultAudioTrack: 'Play the default audio track',
  EnableLocalPassword: 'Enable Jellyfin’s separate local-network password',
  DisplayMissingEpisodes: 'Display missing episodes',
  DisplayCollectionsView: 'Display the collections view',
  HidePlayedInLatest: 'Hide played items in Latest',
  RememberAudioSelections: 'Remember audio selections',
  RememberSubtitleSelections: 'Remember subtitle selections',
  EnableNextEpisodeAutoPlay: 'Play the next episode automatically',
} as const;

const booleanFields = <K extends string>(labels: Record<K, string>) =>
  Object.fromEntries(Object.keys(labels).map(key => [key, v.optional(v.boolean())])) as Record<K, v.OptionalSchema<v.BooleanSchema<undefined>, undefined>>;

export const syncPlayOptions = ['None', 'JoinGroups', 'CreateAndJoinGroups'] as const;
export const subtitleModes = ['Default', 'Smart', 'OnlyForced', 'Always', 'None'] as const;

export const jellyfinSettingsSchema = v.strictObject({
  ...booleanFields(jellyfinPlaybackFlags),
  ...booleanFields(jellyfinPermissionFlags),
  EnableAllFolders: v.optional(v.boolean()),
  BlockedMediaFolders: v.optional(ids),
  EnableAllDevices: v.optional(v.boolean()),
  EnabledDevices: v.optional(v.pipe(v.array(label), v.maxLength(100))),
  EnableAllChannels: v.optional(v.boolean()),
  EnabledChannels: v.optional(ids),
  BlockedChannels: v.optional(ids),
  EnableContentDeletion: v.optional(v.boolean()),
  EnableContentDeletionFromFolders: v.optional(ids),
  PasswordResetProviderId: v.optional(label),
  LoginAttemptsBeforeLockout: v.optional(integer(-1, 2147483647)),
  MaxActiveSessions: v.optional(integer(0, 2147483647)),
  RemoteClientBitrateLimit: v.optional(integer(0, 1_000_000_000)),
  MaxParentalRating: v.optional(v.nullable(integer(0, 1000))),
  MaxParentalSubRating: v.optional(v.nullable(integer(0, 1000))),
  AllowedTags: v.optional(tags),
  BlockedTags: v.optional(tags),
  BlockUnratedItems: v.optional(v.pipe(v.array(v.picklist(unratedItems)), v.maxLength(unratedItems.length))),
  AccessSchedules: v.optional(v.pipe(v.array(schedule), v.maxLength(35))),
  SyncPlayAccess: v.optional(v.picklist(syncPlayOptions)),
});

export const jellyfinConfigurationSchema = v.strictObject({
  ...booleanFields(jellyfinPreferenceFlags),
  AudioLanguagePreference: v.optional(nullableLabel),
  SubtitleLanguagePreference: v.optional(nullableLabel),
  SubtitleMode: v.optional(v.picklist(subtitleModes)),
  GroupedFolders: v.optional(ids),
  OrderedViews: v.optional(ids),
  LatestItemsExcludes: v.optional(ids),
  MyMediaExcludes: v.optional(ids),
  CastReceiverId: v.optional(nullableLabel),
});

export type JellyfinSettings = v.InferOutput<typeof jellyfinSettingsSchema>;
export type JellyfinConfiguration = v.InferOutput<typeof jellyfinConfigurationSchema>;

export function jellyfinHasFamilyLimits(settings: JellyfinSettings) {
  return settings.MaxParentalRating != null || settings.MaxParentalSubRating != null
    || !!(settings.AllowedTags?.length || settings.BlockedTags?.length || settings.BlockUnratedItems?.length || settings.AccessSchedules?.length);
}

export function provisioningAccessWindows(input: unknown) {
  return Array.isArray(input) ? input.map(window => ({
    DayOfWeek: window?.DayOfWeek, StartHour: window?.StartHour, EndHour: window?.EndHour,
  })) : input;
}
