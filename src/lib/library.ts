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
export function libraryBrowseDefaults(parameters: URLSearchParams, profile = false) {
  return {
    collection: profile || parameters.get('collection') === 'true',
    scope: parameters.get('scope') ?? (parameters.get('availability') === 'available' ? 'available' : 'all'),
  };
}
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

/** URL and API filter vocabulary stay together; sources only manage reactive state. */
export function libraryBrowsePaths(options: {
  surface: LibrarySurface; collection: boolean; selection: string; kind: string; scope: string;
  genre: string; relationship: string; source: string; availability: string; username: string; page: number;
}, preview?: { personal?: boolean }) {
  const { surface, collection, selection, kind, scope, genre, relationship, source, availability, username, page } = options;
  if (preview) return {
    api: libraryPath({ preview: true, surface, selection, scope, personal: preview.personal ?? false }),
    href: surface === 'listen' ? '/music?' + new URLSearchParams({kind:selection,scope}) : '/games?' + new URLSearchParams({state: selection, scope, personal: String(preview.personal ?? false)}),
  };
  if (collection) {
    const parameters = new URLSearchParams({ category: surface === 'watch' ? 'screen' : surface === 'listen' ? 'music' : 'game', level: 'root',
      activity: surface === 'listen' ? 'all' : selection === 'progress' || selection === 'in-progress' ? 'active' : selection === 'watched' ? 'completed' : selection,
      kind: surface === 'listen' ? selection : surface === 'play' ? 'all' : kind, relationship, source, availability, ...(username ? { username } : {}), page: String(page) });
    const api = `collection?${parameters}`;
    parameters.set('view', surface);
    parameters.set('collection', 'true');
    return { api, href: `/library?${parameters}` };
  }
  const href = '/library?' + new URLSearchParams({ view: surface, collection: 'false', tracking: selection, kind: surface === 'listen' ? selection : kind, scope, genre, page: String(page) });
  return { api: libraryPath({ surface, selection, kind, scope, genre, page }), href };
}
