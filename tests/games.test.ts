import { expect, test } from 'bun:test';
import * as v from 'valibot';
import { gameInputSchema, gameSessionInputSchema, playthroughUpdateSchema } from '../src/lib/games/model';

test('game metadata rejects invalid dates and duplicate identities', () => {
  expect(v.safeParse(gameInputSchema, { title: 'Game', releaseDate: '2026-02-30' }).success).toBe(false);
  expect(v.safeParse(gameInputSchema, { title: 'Game', identities: [
    { provider: 'igdb', externalId: '1' }, { provider: 'igdb', externalId: '1' },
  ] }).success).toBe(false);
});
test('game play time is bounded and never accepts future sessions or screen progress units', () => {
  const session = { id: crypto.randomUUID(), minutesPlayed: 60, playedAt: '2020-01-01T12:00:00.000Z' };
  expect(v.safeParse(gameSessionInputSchema, session).success).toBe(true);
  for (const minutesPlayed of [0, -1, 1.5, 1441, Infinity])
    expect(v.safeParse(gameSessionInputSchema, { ...session, minutesPlayed }).success).toBe(false);
  expect(v.safeParse(gameSessionInputSchema, { ...session, playedAt: '2999-01-01T00:00:00.000Z' }).success).toBe(false);
  expect(v.safeParse(playthroughUpdateSchema, { positionSeconds: 60 }).success).toBe(false);
  expect(v.safeParse(playthroughUpdateSchema, { progressPercent: 101 }).success).toBe(false);
  expect(v.safeParse(playthroughUpdateSchema, {}).success).toBe(false);
});
