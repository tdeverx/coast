import * as v from 'valibot';

export const uuid = v.pipe(v.string(), v.uuid());
export const inviteCode = v.pipe(v.string(), v.trim(), v.regex(/^[A-Za-z0-9_-]{43}$/, 'Enter a valid invite code.'));
export const inviteLimit = 30;
export const inviteBatchLimit = 20;
export const inviteLabel = v.pipe(v.string(), v.trim(), v.maxLength(120));
export const jellyfinUserId = v.pipe(v.string(), v.regex(/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i));
const tags = v.pipe(v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80))), v.maxLength(30));
const bitrate = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_000_000_000));
const hour = v.pipe(v.number(), v.minValue(0), v.maxValue(24));
export const scheduleDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Everyday', 'Weekday', 'Weekend'] as const;
const schedule = v.pipe(v.strictObject({
  DayOfWeek: v.picklist(scheduleDays), StartHour: hour, EndHour: hour,
}), v.check(item => item.StartHour < item.EndHour, 'An access window must end after it starts.'));
const accessSchema = v.strictObject({
  libraryOnly: v.optional(v.boolean()),
  sharing: v.optional(v.literal(false)),
  social: v.optional(v.literal(false)),
  requests: v.optional(v.literal(false)),
});
export const jellyfinSettingsSchema = v.strictObject({
  EnableMediaPlayback: v.optional(v.boolean()),
  EnableAudioPlaybackTranscoding: v.optional(v.boolean()),
  EnableVideoPlaybackTranscoding: v.optional(v.boolean()),
  EnablePlaybackRemuxing: v.optional(v.boolean()),
  EnableRemoteAccess: v.optional(v.boolean()),
  EnableContentDownloading: v.optional(v.boolean()),
  RemoteClientBitrateLimit: v.optional(bitrate),
  MaxParentalRating: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)))),
  AllowedTags: v.optional(tags),
  BlockedTags: v.optional(tags),
  BlockUnratedItems: v.optional(v.pipe(v.array(v.picklist(['Movie', 'Trailer', 'Series', 'Music', 'Book', 'LiveTvChannel', 'LiveTvProgram', 'ChannelContent', 'Other'])), v.maxLength(9))),
  AccessSchedules: v.optional(v.pipe(v.array(schedule), v.maxLength(35))),
});
export function provisioningAccessWindows(input:unknown) {
  return Array.isArray(input) ? input.map(window=>({
    DayOfWeek:window?.DayOfWeek,StartHour:window?.StartHour,EndHour:window?.EndHour,
  })) : input;
}

export const inviteDefaultsSchema = v.pipe(v.strictObject({
  account: v.optional(v.picklist(['coast', 'managed', 'choice']), 'coast'),
  connectionId: v.optional(uuid),
  folders: v.optional(v.pipe(v.array(jellyfinUserId), v.maxLength(100)), []),
  jellyfin: v.optional(jellyfinSettingsSchema, {}),
  jellyfinTimeZone: v.optional(v.pipe(v.string(),v.trim(),v.maxLength(80),v.check(name=>{
    try {new Intl.DateTimeFormat('en',{timeZone:name});return !/^[+-]/.test(name);}
    catch {return false;}
  },'Use a time zone such as Europe/London.'))),
  access: v.optional(accessSchema, {}),
  preferences: v.optional(v.strictObject({
    theme: v.optional(v.picklist(['dark', 'light', 'system'])),
    originalTitles: v.optional(v.boolean()),
    notificationLevel: v.optional(v.picklist(['silent', 'normal', 'persistent'])),
  }), {}),
  membershipDays: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3650))), null),
}), v.check(input => {
  if (input.access.libraryOnly && input.account !== 'managed') return false;
  return input.account === 'coast' || !!input.connectionId && input.folders.length > 0;
}, 'Choose a Jellyfin administrator and libraries for managed access. Library-only requires a managed account.'),
v.check(input=>!(input.jellyfin.AccessSchedules?.length && !input.jellyfinTimeZone),'Enter the Jellyfin server time zone for access windows.'),
v.transform(input=>{
  const p=input.jellyfin;
  const family=p.MaxParentalRating!=null || !!(p.AllowedTags?.length || p.BlockedTags?.length || p.BlockUnratedItems?.length || p.AccessSchedules?.length);
  return input.account==='managed' && family ? {...input,access:{...input.access,libraryOnly:true}} : input;
}),
v.check(input=>{
  const p=input.jellyfin;
  return input.account==='managed'||!(p.MaxParentalRating!=null||p.AllowedTags?.length||p.BlockedTags?.length||p.BlockUnratedItems?.length||p.AccessSchedules?.length);
},'Family policies require a managed Jellyfin account.'));
export type InviteDefaults = v.InferOutput<typeof inviteDefaultsSchema>;
export type CoastAccess = v.InferOutput<typeof accessSchema>;
export type JellyfinSettings = v.InferOutput<typeof jellyfinSettingsSchema>;
export const emptyInviteDefaults = v.parse(inviteDefaultsSchema, {});
export const invitePath = (code: string) => '/invite#invite=' + encodeURIComponent(code);
