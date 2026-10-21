import {categoryEnabled,type MediumFeatures} from '#lib/experimental.js';
import type { PageWindow } from '#lib/page-window.js';
import type { MediaView, MediaCardPresentation } from '#lib/ui/types.js';
export type LibrarySurface = 'watch' | 'listen' | 'play' | 'read';
export type LibraryContent = {
  items: (MediaView | MediaCardPresentation)[];
  page: number;
  pages: number;
  total: number;
  failure?: string;
  range?: PageWindow;
};
export const librarySortValues = ['default', 'title', 'title-desc', 'added', 'added-asc'] as const;
export type LibrarySort = typeof librarySortValues[number];
export const librarySortOptions = [
  {value:'default',label:'Default order'},
  {value:'title',label:'Title · A–Z'},
  {value:'title-desc',label:'Title · Z–A'},
  {value:'added',label:'Newest added'},
  {value:'added-asc',label:'Oldest added'},
];
export const libraryGenres = ['Action','Adventure','Animation','Comedy','Crime','Documentary','Drama','Family','Fantasy','History','Horror','Music','Mystery','Romance','Science Fiction','Thriller','TV Movie','War','Western'];
export const librarySegmentValues=['all','unwatched','continue','next','finished','later','favourites','dropped'] as const;
export type LibrarySegment=typeof librarySegmentValues[number];
export const librarySegments=librarySegmentValues.map(value=>({value,label:({all:'All',unwatched:'Unwatched',continue:'Continue',next:'Next',finished:'Finished',later:'Later',favourites:'Favourites',dropped:'Dropped'})[value]}));
export const libraryTitles = { watch: 'Watch', listen: 'Listen', play: 'Play', read: 'Read' } as const;
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
  read: [
    { value: 'all', label: 'All' },
    { value: 'planned', label: 'Planned' },
    { value: 'reading', label: 'Reading' },
    { value: 'paused', label: 'Paused' },
    { value: 'completed', label: 'Read' },
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
  firstPage?: number;
  preview?: boolean;
  personal?: boolean;
  sort?: LibrarySort;
  segment?: LibrarySegment;
}) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(options))
    if (value !== undefined) parameters.set(key, String(value));
  return `library?${parameters}`;
}

/** URL and API filter vocabulary stay together; sources only manage reactive state. */
export function libraryBrowsePaths(options: {
  surface: LibrarySurface; collection: boolean; selection: string; kind: string; scope: string;
  sort?: LibrarySort; segment?:LibrarySegment; genre: string; relationship: string; source: string; availability: string; username: string; page: number; firstPage?: number;
}, preview?: { personal?: boolean }) {
  const { surface, collection, selection, kind, scope, genre, relationship, source, availability, username, page, firstPage, sort = 'default', segment='all' } = options;
  if (preview) return {
    api: libraryPath({ preview: true, surface, selection, scope, personal: preview.personal ?? false }),
    href: surface === 'listen' ? '/music?' + new URLSearchParams({kind:selection,scope}) : '/games?' + new URLSearchParams({state: selection, scope, personal: String(preview.personal ?? false)}),
  };
  if (collection || surface==='listen'&&segment!=='all') {
    const parameters = new URLSearchParams({ sort, segment, category: surface === 'watch' ? 'screen' : surface === 'listen' ? 'music' : surface === 'read' ? 'reading' : 'game', level: 'root',
      activity: surface === 'listen' ? 'all' : ['progress','in-progress'].includes(selection) ? 'active' : selection === 'watched' ? 'completed' : selection,
      kind: surface === 'listen' ? selection : surface === 'play' ? 'all' : kind, relationship, source, availability, ...(username ? { username } : {}), page: String(page), ...(firstPage === undefined ? {} : {firstPage:String(firstPage)}) });
    const api = `collection?${parameters}`;
    parameters.set('view', surface);
    parameters.set('collection', String(collection));
    return { api, href: `/library?${parameters}` };
  }
  const href = '/library?' + new URLSearchParams({ view: surface, sort, segment, collection: 'false', tracking: selection, kind: surface === 'listen' ? selection : kind, scope, genre, page: String(page), ...(firstPage === undefined ? {} : {firstPage:String(firstPage)}) });
  return { api: libraryPath({ surface, selection, kind, scope, genre, sort, segment, page, firstPage }), href };
}

/** Library type choices share the same category gates as their data sources. */
export function libraryTypeOptions(config:MediumFeatures){
  return [
    {value:'movie',label:'Movies',surface:'watch',kind:'movie',category:'screen'},
    {value:'show',label:'Shows',surface:'watch',kind:'show',category:'screen'},
    {value:'music',label:'Music',surface:'listen',kind:'all',category:'music'},
    {value:'game',label:'Games',surface:'play',kind:'all',category:'game'},
    {value:'book',label:'Books',surface:'read',kind:'book',category:'book'},
    {value:'comic',label:'Comics',surface:'read',kind:'comic',category:'comic'},
  ].filter(option=>categoryEnabled(config,option.category));
}
