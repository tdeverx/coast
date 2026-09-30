import { describe, expect, test } from 'bun:test';
import { planEpisodeContinuations } from '../src/lib/server/queries/continuations';
import { nextSequenceEntry, type SequenceEntry } from '../src/lib/core/lists/sequence';
import { providerSchedule, providerScheduleSchema } from '../src/lib/providers/schedule';
import * as v from 'valibot';
const episode = (id: string, seasonNumber: number, position: number, extra = {}) => ({
  id,
  groupId: 'show',
  seasonId: `season-${seasonNumber}`,
  seasonNumber,
  position,
  watched: false,
  progress: 0,
  duration: 100,
  dropped: false,
  available: true,
  ...extra,
});
describe('Continue Watching and New Seasons', () => {
  test('tracking includes unavailable next episodes and seasons', () => {
    const watched = episode('watched', 1, 1, { watched: true });
    const unavailable = episode('next', 1, 2, { available: false });
    expect(planEpisodeContinuations([watched, unavailable], false).nextIds).toEqual(['next']);
    expect(planEpisodeContinuations([watched, unavailable]).nextIds).toEqual([]);
    expect(
      planEpisodeContinuations([watched, episode('s2', 2, 1, { available: false })], false)
        .newSeasonIds
    ).toEqual(['season-2']);
  });

  test('keeps an unfinished season in Continue Watching', () => {
    expect(
      planEpisodeContinuations([
        episode('one', 1, 1, { watched: true, progress: 100 }),
        episode('two', 1, 2),
        episode('three', 2, 1),
      ])
    ).toEqual({ nextIds: ['two'], newSeasonIds: [] });
  });
  test('hands off a completed season to only the next of four seasons', () => {
    const seasons = Array.from({ length: 4 }, (_, season) =>
      Array.from({ length: 10 }, (_, episodeIndex) =>
        episode(`s${season + 1}e${episodeIndex + 1}`, season + 1, episodeIndex + 1, {
          watched: season === 0 && episodeIndex < 3,
        })
      )
    ).flat();
    expect(planEpisodeContinuations(seasons)).toEqual({ nextIds: ['s1e4'], newSeasonIds: [] });
    const completed = seasons.map((item) => ({ ...item, watched: item.seasonNumber === 1 }));
    expect(planEpisodeContinuations(completed)).toEqual({
      nextIds: [],
      newSeasonIds: ['season-2'],
    });
    expect(
      planEpisodeContinuations(
        completed.map((item) => (item.id === 's2e1' ? { ...item, watched: true } : item))
      )
    ).toEqual({ nextIds: ['s2e2'], newSeasonIds: [] });
    expect(
      planEpisodeContinuations(
        completed.map((item) => (item.seasonNumber === 2 ? { ...item, available: false } : item))
      )
    ).toEqual({ nextIds: [], newSeasonIds: [] });
  });
  test('does not treat a season with an unwatched gap as complete', () => {
    expect(
      planEpisodeContinuations([
        episode('one', 1, 1),
        episode('two', 1, 2, { watched: true }),
        episode('three', 2, 1),
      ])
    ).toEqual({ nextIds: ['one'], newSeasonIds: [] });
  });
  test('keeps an unfinished episode instead of adding another; starting a season removes its new-season card', () => {
    expect(
      planEpisodeContinuations([
        episode('one', 1, 1, { watched: true, progress: 100 }),
        episode('two', 2, 1, { progress: 10 }),
        episode('three', 2, 2),
      ])
    ).toEqual({ nextIds: [], newSeasonIds: [] });
  });
  test('does not suggest unavailable, dropped, special or completely unstarted seasons', () => {
    expect(
      planEpisodeContinuations([
        episode('special', 0, 1, { watched: true }),
        episode('one', 1, 1),
        episode('two', 2, 1, { available: false }),
      ])
    ).toEqual({ nextIds: [], newSeasonIds: [] });
    expect(
      planEpisodeContinuations([
        episode('one', 1, 1, { watched: true, progress: 100 }),
        episode('two', 2, 1, { dropped: true }),
      ]).newSeasonIds
    ).toEqual([]);
  });
  test('ordered sequences retain unwatched gaps and only skip on an explicit cursor', () => {
    const entries: SequenceEntry[] = ['first', 'gap', 'last'].map((id, index) => ({
      entryId: id,
      mediaId: id,
      watched: index === 0,
      progress: 0,
      duration: 100,
      dropped: false,
      startedAt: null,
    }));
    expect(nextSequenceEntry(entries)?.entryId).toBe('gap');
    expect(nextSequenceEntry(entries, 'gap')?.entryId).toBe('last');
    expect(nextSequenceEntry(entries, 'last')).toBeNull();
    expect(() => nextSequenceEntry(entries, 'removed')).toThrow();
  });
});
test('schedule defaults preserve existing cadence and keep Trakt imports opt-in', () => {
  expect(providerSchedule('jellyfin')).toMatchObject({
    enabled: true,
    intervalMinutes: 10,
    fullIntervalHours: 24,
  });
  expect(providerSchedule('seerr').intervalMinutes).toBe(1);
  expect(providerSchedule('trakt').enabled).toBe(false);
  expect(
    v.safeParse(providerScheduleSchema, {
      enabled: true,
      intervalMinutes: 0,
      fullIntervalHours: 24,
    }).success
  ).toBe(false);
});
