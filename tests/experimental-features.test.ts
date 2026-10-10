import { expect, test } from 'bun:test';
import { defaultConfig } from '../src/lib/server/config';
import { categoryEnabled, mediumOptions, surfaceEnabled, type ExperimentalFeature } from '../src/lib/experimental';
import { experimentalPathFeature, requireExperimentalFeature } from '../src/lib/server/experimental';
import { mediaTypeOptions } from '../src/lib/ui/filter-options';

test('each experimental medium and Parties defaults off and enables independently', () => {
  for (const feature of ['music','gaming','parties','books','comics'] as const) {
    expect(() => requireExperimentalFeature(defaultConfig,feature)).toThrow('disabled');
    const config={...defaultConfig,[{music:'experimentalMusic',gaming:'experimentalGaming',parties:'experimentalParties',books:'experimentalBooks',comics:'experimentalComics'}[feature]]:true};
    for(const other of ['music','gaming','parties','books','comics'] as const) {
      if(other===feature)expect(()=>requireExperimentalFeature(config,other)).not.toThrow();
      else expect(()=>requireExperimentalFeature(config,other)).toThrow('disabled');
    }
  }
});
test('pages, encoded paths and nested API routes resolve to their own gate', () => {
  const paths:Record<ExperimentalFeature,string[]>={
    music:['/music','/music/connection/item','/music/__data.json','/api/v1/music/queue','/api/v1/providers/id%2Fmusic','/api/v1/providers/id/music/item/artwork'],
    gaming:['/g%61mes','/games','/games/__data.json','/games/igdb/source/item','/api/v1/%67ames','/api/v1/games/import','/api/v1/game-playthroughs/id/sessions'],
    parties:['/synced/id','/api/v1/synced','/api/v1/synced/id/heartbeat'],
    books:['/media/openlibrary/OL1W','/media/openl%69brary/OL1W','/media/openlibrary/OL1W/__data.json'],
    comics:['/media/comic-vine/4000-1','/media/comic-vine/4000-1/__data.json']
  };
  for(const [feature,routes] of Object.entries(paths))for(const path of routes)expect(experimentalPathFeature(path)).toBe(feature as ExperimentalFeature);
  for(const path of ['/library','/settings/policies','/api/v1/playback','/api/v1/providers/id/scan','/api/v1/requests','/music-other','/games-other','/api/v1/games-other','/%zz'])expect(experimentalPathFeature(path)).toBeNull();
});
test('medium segments and list filters cannot expose a disabled medium', () => {
  const music={...defaultConfig,experimentalMusic:true},gaming={...defaultConfig,experimentalGaming:true},parties={...defaultConfig,experimentalParties:true};
  expect(mediumOptions(music).map(o=>o.value)).toEqual(['screen','music']);
  expect(mediumOptions(gaming).map(o=>o.value)).toEqual(['screen','game']);
  expect(mediumOptions(parties).map(o=>o.value)).toEqual(['screen']);
  expect(mediaTypeOptions(music).map(o=>o.value)).toEqual(['all','movie','show','album','track']);
  expect(mediaTypeOptions(gaming).map(o=>o.value)).toEqual(['all','movie','show','game']);
  expect(surfaceEnabled(music,'listen')).toBe(true);
  expect(surfaceEnabled(music,'play')).toBe(false);
  expect(categoryEnabled(gaming,'music')).toBe(false);
  expect(categoryEnabled(parties,'screen')).toBe(true);
  expect(categoryEnabled(music,'unknown')).toBe(false);
});

test('Reading joins shared surfaces while subtype gates and unsupported controls stay independent', () => {
  const books={...defaultConfig,experimentalBooks:true};
  const comics={...defaultConfig,experimentalComics:true};
  for(const config of [books,comics]) {
    expect(surfaceEnabled(config,'read')).toBe(true);
    expect(mediumOptions(config).map(option=>option.value)).toEqual(['screen','reading']);
    expect(mediumOptions(config,['screen','game','music']).map(option=>option.value)).toEqual(['screen']);
  }
  expect(mediaTypeOptions(books).map(option=>option.value)).toEqual(['all','movie','show','book']);
  expect(mediaTypeOptions(comics).map(option=>option.value)).toEqual(['all','movie','show','comic']);
  expect(categoryEnabled(books,'comic')).toBe(false);
  expect(categoryEnabled(comics,'book')).toBe(false);
  expect(surfaceEnabled(defaultConfig,'read')).toBe(false);
});
