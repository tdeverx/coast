import * as v from 'valibot';
import { audiences } from '#lib/social/model.js';
import { jellyfinConfigurationSchema, jellyfinHasFamilyLimits, jellyfinSettingsSchema, jellyfinUserId } from './jellyfin-preset';

export { jellyfinSettingsSchema, jellyfinUserId, provisioningAccessWindows, scheduleDays, type JellyfinSettings } from './jellyfin-preset';

export const uuid = v.pipe(v.string(), v.uuid());
export const inviteCode = v.pipe(v.string(), v.trim(), v.regex(/^[A-Za-z0-9_-]{43}$/, 'Enter a valid invite code.'));
export const inviteLimit = 30;
export const inviteBatchLimit = 20;
export const inviteLabel = v.pipe(v.string(), v.trim(), v.maxLength(120));
const accessSchema = v.strictObject({
  libraryOnly: v.optional(v.boolean()),
  sharing: v.optional(v.literal(false)),
  social: v.optional(v.literal(false)),
  requests: v.optional(v.literal(false)),
  parties: v.optional(v.literal(false)),
});
export const inviteDefaultsSchema = v.pipe(v.strictObject({
  account: v.optional(v.picklist(['coast', 'managed', 'choice']), 'coast'),
  connectionId: v.optional(uuid),
  folders: v.optional(v.pipe(v.array(jellyfinUserId), v.maxLength(100)), []),
  jellyfin: v.optional(jellyfinSettingsSchema, {}),
  jellyfinConfiguration: v.optional(jellyfinConfigurationSchema),
  jellyfinTimeZone: v.optional(v.pipe(v.string(),v.trim(),v.maxLength(80),v.check(name=>{
    try {new Intl.DateTimeFormat('en',{timeZone:name});return !/^[+-]/.test(name);}
    catch {return false;}
  },'Use a time zone such as Europe/London.'))),
  access: v.optional(accessSchema, {}),
  preferences: v.optional(v.strictObject({
    theme: v.optional(v.picklist(['dark', 'light', 'system'])),
    originalTitles: v.optional(v.boolean()),
    notificationLevel: v.optional(v.picklist(['silent', 'normal', 'persistent'])),
    subtitlesAlways: v.optional(v.boolean()),
    subtitlePrompt: v.optional(v.boolean()),
    subtitleLanguages: v.optional(v.pipe(v.array(v.pipe(v.string(),v.trim(),v.minLength(1),v.maxLength(16))),v.maxLength(10))),
    social: v.optional(v.strictObject({ audience: v.optional(v.picklist(audiences)) })),
  }), {}),
  membershipDays: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3650))), null),
}), v.check(input => {
  const restricted = input.access.libraryOnly || jellyfinHasFamilyLimits(input.jellyfin);
  if (restricted && (input.account !== 'managed' || input.jellyfin.EnableAllFolders
    || input.jellyfin.EnableContentDeletion || input.jellyfin.EnableContentDeletionFromFolders?.length)) return false;
  return input.account === 'coast' || !!input.connectionId && (input.folders.length > 0 || input.jellyfin.EnableAllFolders === true);
}, 'Choose a Jellyfin administrator and libraries. Restricted accounts need specific libraries and cannot delete media.'),
v.check(input => !(input.jellyfin.AccessSchedules?.length && !input.jellyfinTimeZone), 'Enter the Jellyfin server time zone for access windows.'),
v.transform(input => {
  if (jellyfinHasFamilyLimits(input.jellyfin)) input.access.libraryOnly = true;
  if (input.preferences.notificationLevel === 'silent') {
    delete input.preferences.notificationLevel;
  }
  return input;
}));
export type InviteDefaults = v.InferOutput<typeof inviteDefaultsSchema>;
export type CoastAccess = v.InferOutput<typeof accessSchema>;
export const emptyInviteDefaults = v.parse(inviteDefaultsSchema, {});
export const invitePath = (code: string) => '/invite#invite=' + encodeURIComponent(code);
