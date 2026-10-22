import {resolveAction,actionUrl} from '#lib/actions.js';
import { getFeatureConfig } from '#lib/server/features.js';
import { categoryEnabled, surfaceEnabled } from '#lib/experimental.js';
import { error } from '@sveltejs/kit';
import { publicSearch } from '#lib/social/public.server.js';
import * as v from 'valibot';
import { searchMedia } from '#lib/catalogue/service.server.js';
import { mediaViews } from '#lib/server/queries/media.js';
import { readingSearch, readingSearchInitial, searchPresentations, type ReadingSearchContent } from '#lib/server/queries/search.js';
import { searchSelection, searchDemand, type SearchSelection, type SearchRowSelection } from '#lib/search-selection.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({locals, url, depends,request}) => {
  depends('coast:tracking');
  depends('coast:reading');
  depends('coast:providers');
  const config = await getFeatureConfig(locals.user?.id??null);
  if(locals.user)url=actionUrl(url,locals.user.settings?.action,config);
  const action=locals.user?resolveAction(url.searchParams,locals.user.settings?.action,config):'watch';
  let selection: SearchSelection;
  try { selection = searchSelection(url.searchParams,action); }
  catch (cause) { if (cause instanceof v.ValiError) error(400, 'Choose valid search filters.'); throw cause; }
  const { query, view: selectedView, kind, readingFilters } = selection;
  const signal = request?.signal;
  signal?.throwIfAborted();
  const readingEmpty: ReadingSearchContent = { items: [], failure: '', notice: '', truncated: false, page: readingFilters.page, pages: 1, total: 0 };
  if (!locals.user) {
    if ((await getFeatureConfig(null)).siteAccess !== 'public-read-only') error(401, 'Sign in to search.');
    const items = query ? await publicSearch(query) : [];
    const initial = {items:items.slice(0,100),providerUnavailable:false,truncated:items.length>100};
    const empty = {items:[],discover:[],failure:'',truncated:false};
    const publicRow = (row: SearchRowSelection) => ({ kind: row.kind === 'movie' || row.kind === 'show' ? row.kind : 'all' as const, view: 'watch' as const });
    return {query,kind:kind==='movie'||kind==='show'?kind:'all',view:'watch',rows:{available:publicRow(selection.rows.available),unavailable:publicRow(selection.rows.unavailable)},filtered:selection.filtered,demand:{watch:true,listen:false,play:false,read:false},initial,readingInitial:readingEmpty,watch:Promise.resolve(initial),listen:Promise.resolve(empty),play:Promise.resolve(empty),read:Promise.resolve(readingEmpty),readingFilters};
  }

  for (const row of Object.values(selection.rows)) {
    if (row.view !== 'all' && !surfaceEnabled(config,row.view)) error(404, 'This search view is unavailable.');
    if ((row.kind === 'book' || row.kind === 'comic') && !categoryEnabled(config,row.kind)) error(404, 'This reading type is unavailable.');
  }
  const demand = searchDemand(selection, config);
  const readingInput = { query, ...selection.readingInput };
  const [items, readingInitial] = await Promise.all([
    query && demand.watch
      ? mediaViews(locals.user.id, { query, availableFirst: true, limit: 101 })
      : [],
    query && demand.read ? readingSearchInitial(locals.user.id, readingInput) : readingEmpty,
  ]);
  const initial = {
    items: items.slice(0, 100),
    providerUnavailable: false,
    truncated: items.length > 100,
  };
  const empty = { items: [], discover: [], failure: '', truncated: false };
  return {
    query,
    view: selectedView,
    kind,
    rows: selection.rows,
    filtered: selection.filtered,
    demand,
    initial,
    readingInitial,
    readingFilters,
    watch:
      query && demand.watch && !signal?.aborted
        ? searchMedia(locals.user.id, query).catch(() => ({
            ...initial,
            providerUnavailable: !signal?.aborted,
          }))
        : Promise.resolve(initial),
    listen:
      query && demand.listen && !signal?.aborted
        ? searchPresentations(locals.user.id, 'listen', query, 'all',signal).catch(() => ({
            ...empty,
            failure: signal?.aborted ? '' : 'Music search could not be loaded. Please try again.',
          }))
        : Promise.resolve(empty),
    play:
      query && demand.play && !signal?.aborted
        ? searchPresentations(locals.user.id, 'play', query, 'all',signal).catch(() => ({
            ...empty,
            failure: signal?.aborted ? '' : 'Game search could not be loaded. Please try again.',
          }))
        : Promise.resolve(empty),
    read:
      query && demand.read && !signal?.aborted
        ? readingSearch(locals.user.id, readingInput, readingInitial).catch(() => ({ ...readingInitial, failure: signal?.aborted ? '' : 'Reading search could not be loaded. Please try again.' }))
        : Promise.resolve(readingEmpty),
  };
};
