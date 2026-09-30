import * as v from 'valibot';
export const providerScheduleSchema = v.object({
  enabled: v.boolean(),
  intervalMinutes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10080)),
  fullIntervalHours: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(720)),
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
      };
}
