export type FilterOption = { value: string; label: string };
export type ScreenMediaFilter = 'all' | 'movie' | 'show';
export type MediaFilter = ScreenMediaFilter | 'album' | 'track' | 'game';
export function mediaTypeOptions(includeOtherMedia = false): FilterOption[] {
  return [
    { value: 'all', label: 'All' },
    { value: 'movie', label: 'Movies' },
    { value: 'show', label: 'Shows' },
    ...(includeOtherMedia ? [
      { value: 'album', label: 'Albums' },
      { value: 'track', label: 'Tracks' },
      { value: 'game', label: 'Games' },
    ] : []),
  ];
}
