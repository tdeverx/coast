import type { MediaView, MediaCardPresentation } from '$lib/ui/types';
export type LibrarySurface = 'watch' | 'listen' | 'play';
export type LibraryContent = {
  items: (MediaView | MediaCardPresentation)[];
  page: number;
  pages: number;
  total: number;
  failure?: string;
};
export const libraryTitles = { watch: 'Watch', listen: 'Listen', play: 'Play' } as const;
export const librarySelections = {
  watch: [
    { value: 'all', label: 'All' },
    { value: 'unwatched', label: 'Unwatched' },
    { value: 'progress', label: 'In progress' },
    { value: 'watched', label: 'Watched' },
    { value: 'dropped', label: 'Dropped' },
  ],
  listen: [
    { value: 'all', label: 'All' },
    { value: 'album', label: 'Albums' },
    { value: 'artist', label: 'Artists' },
    { value: 'track', label: 'Tracks' },
  ],
  play: [
    { value: 'all', label: 'All' },
    { value: 'planned', label: 'Planned' },
    { value: 'in-progress', label: 'In progress' },
    { value: 'paused', label: 'Paused' },
    { value: 'completed', label: 'Completed' },
    { value: 'dropped', label: 'Dropped' },
  ],
};

/** Shared request vocabulary for library browsing and its home-page previews. */
export function libraryPath(options: {
  surface: LibrarySurface;
  selection?: string;
  kind?: string;
  scope?: string;
  genre?: string;
  page?: number;
  preview?: boolean;
  personal?: boolean;
}) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(options))
    if (value !== undefined) parameters.set(key, String(value));
  return `library?${parameters}`;
}
