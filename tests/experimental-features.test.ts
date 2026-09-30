import { expect, test } from 'bun:test';
import { defaultConfig } from '../src/lib/server/config';
import { isExperimentalPath, requireExperimentalFeatures } from '../src/lib/server/experimental';

test('experimental features default off and can be enabled and disabled', () => {
  expect(defaultConfig.experimentalFeatures).toBe(false);
  expect(() => requireExperimentalFeatures(defaultConfig)).toThrow(
    'Experimental features are disabled'
  );
  expect(() => requireExperimentalFeatures({ experimentalFeatures: true })).not.toThrow();
  expect(() => requireExperimentalFeatures({ experimentalFeatures: false })).toThrow();
});
test('gate covers all music/game pages and API reads, writes, details and artwork', () => {
  for (const path of [
    '/g%61mes',
    '/api/v1/%67ames',
    '/api/v1/providers/id%2Fmusic',
    '/music',
    '/music/connection/item',
    '/music/__data.json',
    '/games',
    '/games/igdb/source/item',
    '/games/__data.json',
    '/api/v1/games',
    '/api/v1/games/import',
    '/api/v1/game-playthroughs/id/sessions',
    '/api/v1/providers/id/music',
    '/api/v1/providers/id/music/item/artwork',
  ])
    expect(isExperimentalPath(path)).toBe(true);
  for (const path of [
    '/library',
    '/settings/policies',
    '/api/v1/playback',
    '/api/v1/providers/id/scan',
    '/api/v1/requests',
    '/music-other',
    '/games-other',
    '/api/v1/games-other',
  ])
    expect(isExperimentalPath(path)).toBe(false);
});
