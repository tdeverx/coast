import * as v from 'valibot';

const count = v.pipe(v.number(), v.integer(), v.minValue(0));
export const jellyfinScanProgressSchema = v.object({
  processed: count,
  total: v.nullable(count),
  startedAt: v.string(),
  scanId: v.optional(v.pipe(v.string(), v.uuid())),
  accountGeneration: v.optional(v.pipe(v.string(), v.uuid())),
  phase: v.picklist(['scanning', 'watched', 'resume', 'favourites', 'reconciling', 'music-albums', 'music-tracks', 'reading', 'finalizing', 'complete']),
  stageProcessed: v.optional(count),
  stageTotal: v.optional(v.nullable(count)),
  playbackCursor: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  readingOffset: v.optional(count),
  musicOffset: v.optional(count),
  musicFilter: v.optional(v.pipe(count, v.maxValue(3))),
});
export type JellyfinScanProgress = v.InferOutput<typeof jellyfinScanProgressSchema>;
export function jellyfinImportStage(phase: JellyfinScanProgress['phase']) {
  return {
    scanning: 'Checking library access',
    watched: 'Reading watched state',
    resume: 'Reading resume points',
    favourites: 'Reading favourites',
    reconciling: 'Importing progress and favourites',
    'music-albums': 'Importing albums',
    'music-tracks': 'Importing listening history',
    reading: 'Checking reading files',
    finalizing: 'Finishing your library',
    complete: 'Complete',
  }[phase];
}
