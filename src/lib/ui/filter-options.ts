export type FilterOption = { value: string; label: string };
export function mediaTypeOptions(features: Partial<import('$lib/experimental').MediumFeatures> = {}): FilterOption[] {
  return [
    { value: 'all', label: 'All' },
    { value: 'movie', label: 'Movies' },
    { value: 'show', label: 'Shows' },
    ...(features.experimentalMusic ? [
      { value: 'album', label: 'Albums' },
      { value: 'track', label: 'Tracks' },
    ] : []),
    ...(features.experimentalGaming ? [{ value: 'game', label: 'Games' }] : []),
    ...(features.experimentalBooks ? [{ value: 'book', label: 'Books' }] : []),
    ...(features.experimentalComics ? [{ value: 'comic', label: 'Comics' }] : []),
  ];
}

export function readingTypeOptions(features: Partial<import('$lib/experimental').MediumFeatures>): FilterOption[] {
  return mediaTypeOptions(features).filter(option => ['all', 'book', 'comic'].includes(option.value));
}
