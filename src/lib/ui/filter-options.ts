export type FilterOption = { value: string; label: string };
export function mediaTypeOptions(features: Partial<import('#lib/experimental.js').MediumFeatures> = {}): FilterOption[] {
  return [
    { value: 'all', label: 'All' },
    ...(features.features?.screen===false ? [] : [{ value: 'movie', label: 'Movies' }, { value: 'show', label: 'Shows' }]),
    ...(features.experimentalMusic ? [
      { value: 'album', label: 'Albums' },
      { value: 'track', label: 'Tracks' },
    ] : []),
    ...(features.experimentalGaming ? [{ value: 'game', label: 'Games' }] : []),
    ...(features.experimentalBooks ? [{ value: 'book', label: 'Books' }] : []),
    ...(features.experimentalComics ? [{ value: 'comic', label: 'Comics' }] : []),
  ].filter(option=>option.value==='all'||features.features?.[(['movie','show'].includes(option.value)?'screen':['album','track'].includes(option.value)?'music':option.value) as keyof import('#lib/features.js').FeatureValues]!==false);
}

export function readingTypeOptions(features: Partial<import('#lib/experimental.js').MediumFeatures>): FilterOption[] {
  return mediaTypeOptions(features).filter(option => ['all', 'book', 'comic'].includes(option.value));
}
