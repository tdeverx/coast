import { categoryEnabled, surfaceEnabled } from '$lib/experimental';
import { error } from '@sveltejs/kit';
import { publicSearch } from '$lib/social/public.server';
import * as v from 'valibot';
import { searchMedia } from '$lib/catalogue/service.server';
import { mediaViews } from '$lib/server/queries/media';
import { getConfig } from '$lib/server/config';
import { readingSearch, readingSearchInitial, searchPresentations, type ReadingSearchContent } from '$lib/server/queries/search';
import { READING_PROVIDER_PAGE_LIMIT } from '$lib/reading/model';
import { pageNumberSchema } from '$lib/server/queries/pagination';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({locals, url, depends}) => {
  depends('coast:tracking');
  depends('coast:reading');
  depends('coast:providers');
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const view = v.safeParse(
    v.picklist(['all', 'watch', 'listen', 'play', 'read']),
    url.searchParams.get('view') ?? 'all'
  );
  if (!view.success) error(400, 'Choose a valid search view.');
  const type = v.safeParse(v.picklist(['all', 'movie', 'show', 'album', 'artist', 'track', 'game', 'book', 'comic']),
    url.searchParams.get('type') ?? (view.output === 'read' ? url.searchParams.get('kind') ?? 'all' : 'all'));
  if (!type.success) error(400, 'Choose a valid media type.');
  const selectedView = type.output === 'all' ? view.output : ['movie', 'show'].includes(type.output) ? 'watch' : ['album', 'artist', 'track'].includes(type.output) ? 'listen' : type.output === 'game' ? 'play' : 'read';
  const readingFilters = v.safeParse(v.object({
    kind: v.picklist(['all', 'book', 'comic']),
    page: pageNumberSchema,
  }), {
    kind: ['book', 'comic'].includes(type.output) ? type.output : 'all',
    page: view.output === 'read' ? Number(url.searchParams.get('page') ?? '1') : 1,
  });
  if (!readingFilters.success) error(400, 'Choose valid reading search filters.');
  const readingEmpty: ReadingSearchContent = { items: [], failure: '', notice: '', truncated: false, page: readingFilters.output.page, pages: 1, total: 0 };
  if (!locals.user) {
    if ((await getConfig()).siteAccess !== 'public-read-only') error(401, 'Sign in to search.');
    const items = query ? await publicSearch(query) : [];
    const initial = {items:items.slice(0,100),providerUnavailable:false,truncated:items.length>100};
    const empty = {items:[],discover:[],failure:'',truncated:false};
    return {query,kind:['movie','show'].includes(type.output)?type.output:'all',view:'watch',initial,readingInitial:readingEmpty,watch:Promise.resolve(initial),listen:Promise.resolve(empty),play:Promise.resolve(empty),read:Promise.resolve(readingEmpty),readingFilters:readingFilters.output};
  }

  const config = await getConfig();
  if (selectedView !== 'all' && !surfaceEnabled(config,selectedView))
    error(404, 'This search view is unavailable.');
  if (selectedView === 'read') {
    if (readingFilters.output.kind !== 'all' && !categoryEnabled(config, readingFilters.output.kind)) error(404, 'This reading type is unavailable.');
  }
  if (readingFilters.output.page > READING_PROVIDER_PAGE_LIMIT) error(400, 'Choose a valid reading search page.');
  const readingEnabled = config.experimentalBooks || config.experimentalComics;
  const readingInput = { query, kind: 'all', page: 1 };
  const [items, readingInitial] = await Promise.all([
    query
      ? mediaViews(locals.user.id, { query, availableFirst: true, limit: 101 })
      : [],
    readingEnabled ? readingSearchInitial(locals.user.id, readingInput) : readingEmpty,
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
    kind: type.output,
    initial,
    readingInitial,
    readingFilters: readingFilters.output,
    watch:
      query
        ? searchMedia(locals.user.id, query).catch(() => ({
            ...initial,
            providerUnavailable: true,
          }))
        : Promise.resolve(initial),
    listen:
      config.experimentalMusic
        ? searchPresentations(locals.user.id, 'listen', query, 'all').catch(() => ({
            ...empty,
            failure: 'Music search could not be loaded. Please try again.',
          }))
        : Promise.resolve(empty),
    play:
      config.experimentalGaming
        ? searchPresentations(locals.user.id, 'play', query, 'all').catch(() => ({
            ...empty,
            failure: 'Game search could not be loaded. Please try again.',
          }))
        : Promise.resolve(empty),
    read:
      readingEnabled
        ? readingSearch(locals.user.id, readingInput, readingInitial).catch(() => ({ ...readingInitial, failure: 'Reading search could not be loaded. Please try again.' }))
        : Promise.resolve(readingEmpty),
  };
};
