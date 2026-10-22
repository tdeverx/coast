import type { ReadonlyURL } from '$app/state';
import * as v from 'valibot';
import { surfaceEnabled, type MediumFeatures } from './experimental';
import { READING_PROVIDER_PAGE_LIMIT } from './reading/model';

export const searchSurfaces = ['watch', 'listen', 'play', 'read'] as const;
export type SearchSurface = typeof searchSurfaces[number];
export type SearchView = SearchSurface | 'all';
const viewSchema = v.picklist(['all', ...searchSurfaces]);
const typeSchema = v.picklist(['all', 'movie', 'show', 'album', 'artist', 'track', 'game', 'book', 'comic']);
export type SearchType = v.InferOutput<typeof typeSchema>;
export type SearchBucket = 'available' | 'unavailable';
export type SearchRowSelection = { kind: SearchType; view: SearchView };
export type SearchSelection = ReturnType<typeof searchSelection>;
const rowParameter = { available: 'availableType', unavailable: 'unavailableType' } as const;

export function searchSurface(kind: string): SearchSurface | undefined {
  if (['movie', 'show', 'season', 'episode', 'collection'].includes(kind)) return 'watch';
  if (['album', 'artist', 'track'].includes(kind)) return 'listen';
  if (kind === 'game') return 'play';
  if (kind === 'book' || kind === 'comic') return 'read';
}

/** Two row selections retain their own scope; shared work serves only their union. */
export function searchSelection(input: Pick<URLSearchParams,'get'>, action?:SearchSurface) {
  const parameters=new URLSearchParams();
  for(const key of ['q','view','type','kind','page','availableType','unavailableType']){const value=input.get(key);if(value!==null)parameters.set(key,value);}
  if(action){
    parameters.set('view',action);
    for(const key of ['type','kind','availableType','unavailableType']){const kind=parameters.get(key);if(kind!==null)v.parse(typeSchema,kind);if(kind&&kind!=='all'&&searchSurface(kind)!==action)parameters.delete(key);}
  }
  const query = (parameters.get('q') ?? '').trim().slice(0, 200);
  const requestedView = v.parse(viewSchema, parameters.get('view') ?? 'all');
  const kind = v.parse(typeSchema, parameters.get('type') ?? (requestedView === 'read' ? parameters.get('kind') ?? 'all' : 'all'));
  const view: SearchView = kind === 'all' ? requestedView : searchSurface(kind)!;
  function row(bucket: SearchBucket): SearchRowSelection {
    const value = parameters.get(rowParameter[bucket]);
    return value === null ? { kind, view } : {
      kind: v.parse(typeSchema, value), view: value === 'all' ? action??'all' : searchSurface(value)!,
    };
  }
  // Keep the established explicit reading page/subtype contract. Row filters
  // do not change an admitted family's result cap, rank or pagination budget.
  const page = requestedView === 'read'
    ? v.parse(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(READING_PROVIDER_PAGE_LIMIT)), Number(parameters.get('page') ?? '1')) : 1;
  const readingKind = kind === 'book' || kind === 'comic' ? kind : 'all';
  const rows = { available: row('available'), unavailable: row('unavailable') };
  const readingTypes = Object.values(rows).filter(value => value.view === 'all' || value.view === 'read').map(value =>
    value.kind === 'book' || value.kind === 'comic' ? value.kind : 'all');
  const readingUnion = readingTypes.length && readingTypes.every(value => value === readingTypes[0]) ? readingTypes[0] : 'all';
  return { query, view, kind, rows,
    readingFilters: { kind: readingKind, page },
    readingInput: requestedView === 'read' ? { kind: readingUnion, page } : { kind: 'all' as const, page: 1 },
    filtered: requestedView !== 'all' || kind !== 'all' || parameters.has('availableType') || parameters.has('unavailableType'),
  };
}

export function searchDemand(selection: Pick<SearchSelection, 'rows'>, features: MediumFeatures) {
  return Object.fromEntries(searchSurfaces.map(surface => [surface, surfaceEnabled(features, surface) &&
    Object.values(selection.rows).some(row => row.view === 'all' || row.view === surface)])) as Record<SearchSurface, boolean>;
}

export function searchRowMatches(selection: { kind?: string; view?: SearchView }, kind: string) {
  return (!selection.kind || selection.kind === 'all' || selection.kind === kind) &&
    (!selection.view || selection.view === 'all' || searchSurface(kind) === selection.view);
}

/** Changes to one row preserve the other primitive and the incoming defaults. */
export function searchSelectionUrl(url: ReadonlyURL, query: string, row?: { bucket: SearchBucket; kind: string }) {
  const parameters = new URLSearchParams(url.searchParams.toString());
  parameters.set('q', query.trim().slice(0, 200));
  if (row) parameters.set(rowParameter[row.bucket], v.parse(typeSchema, row.kind));
  parameters.delete('page');
  parameters.delete('scope');
  return url.pathname + '?' + parameters + url.hash;
}
