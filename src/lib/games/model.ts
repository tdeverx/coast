import * as v from 'valibot';

export const gameStatuses = ['planned', 'in-progress', 'completed', 'paused', 'dropped'] as const;
export type GameStatus = (typeof gameStatuses)[number];
const label = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(250));
const labels = v.pipe(v.array(label), v.maxLength(50));
export const gameInputSchema = v.strictObject({
  title: label,
  overview: v.optional(v.pipe(v.string(), v.maxLength(5000))),
  releaseDate: v.optional(v.pipe(v.string(), v.isoDate(), v.check((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid release date.'))),
  platforms: v.optional(labels, []),
  genres: v.optional(labels, []),
  developers: v.optional(labels, []),
  publishers: v.optional(labels, []),
  identities: v.optional(v.pipe(v.array(v.strictObject({
    provider: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,49}$/)),
    externalId: label,
  })), v.maxLength(20), v.check((items) => new Set(items.map((item) => `${item.provider}:${item.externalId}`)).size === items.length, 'Provider identities must be unique.')), []),
});
export const playthroughInputSchema = v.strictObject({
  status: v.optional(v.picklist(['planned', 'in-progress']), 'planned'),
  platform: v.optional(label),
  repeat: v.optional(v.boolean(), false),
});
export const playthroughUpdateSchema = v.pipe(v.strictObject({
  status: v.optional(v.picklist(gameStatuses)),
  progressPercent: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100))),
}), v.check((input) => input.status !== undefined || input.progressPercent !== undefined, 'Supply a status or progress percentage.'));
export const gameSessionInputSchema = v.strictObject({
  // A caller-generated UUID makes retries safe without merging distinct sessions.
  id: v.pipe(v.string(), v.uuid()),
  minutesPlayed: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1440)),
  playedAt: v.pipe(v.string(), v.isoTimestamp(), v.check((value) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now(), 'Play sessions must have a valid date in the past.')),
  note: v.optional(v.pipe(v.string(), v.maxLength(2000))),
});
