import * as v from 'valibot';
export const providerScheduleSchema = v.object({
  enabled: v.boolean(),
  recommendationsEnabled:v.optional(v.boolean(),true),
  recommendationsIntervalMinutes:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10080)),60),
  catalogueEnabled: v.optional(v.boolean(), true),
  catalogueIntervalMinutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10080)), 1440),
  intervalMinutes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10080)),
  fullIntervalHours: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(720)),
  listsIntervalMinutes: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10080)),
    60
  ),
  liveEnabled: v.optional(v.boolean(),true),
  liveIdleMinutes:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10080)),5),
  liveActiveMinutes:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10080)),1),
  trackingEnabled: v.optional(v.boolean(), true),
  listsEnabled: v.optional(v.boolean(), true),
  libraryEnabled: v.optional(v.boolean(), true),
  userSyncEnabled: v.optional(v.boolean(), true),
  userIntervalMinutes: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10080)),
    10
  ),
  libraryConnectionId: v.optional(v.nullable(v.pipe(v.string(), v.uuid())), null),
});
export type ProviderSchedule = v.InferOutput<typeof providerScheduleSchema>;
export function providerSchedule(provider: string, saved?: unknown): ProviderSchedule {
  const parsed = v.safeParse(providerScheduleSchema, saved);
  return parsed.success
    ? parsed.output
    : {
        enabled: !['trakt', 'igdb'].includes(provider),
        recommendationsEnabled:true,recommendationsIntervalMinutes:60,
        intervalMinutes: provider === 'tmdb' ? 10080 : provider === 'jellyfin' ? 10 : provider === 'seerr' ? 1 : 60,
        catalogueEnabled: true, catalogueIntervalMinutes: 1440,
        fullIntervalHours: 24,
        listsIntervalMinutes: 60,
        liveEnabled:true,liveIdleMinutes:5,liveActiveMinutes:1,
        trackingEnabled: true,
        listsEnabled: true,
        libraryEnabled: true,
        userSyncEnabled: true,
        userIntervalMinutes: provider === 'steam' ? 60 : 10,
        libraryConnectionId: null,
      };
}
