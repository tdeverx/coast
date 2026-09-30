import * as v from 'valibot';
export const providerScheduleSchema = v.object({
  enabled: v.boolean(),
  intervalMinutes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10080)),
  fullIntervalHours: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(720)),
  listsIntervalMinutes: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10080)),
    60
  ),
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
        intervalMinutes: provider === 'jellyfin' ? 10 : provider === 'seerr' ? 1 : 60,
        fullIntervalHours: 24,
        listsIntervalMinutes: 60,
        trackingEnabled: true,
        listsEnabled: true,
        libraryEnabled: true,
        userSyncEnabled: true,
        userIntervalMinutes: 10,
        libraryConnectionId: null,
      };
}
