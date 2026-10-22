import { requestedPageInterval } from '#lib/server/queries/pagination.js';
import { getFeatureConfig } from '#lib/server/features.js';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { libraryOptionsSchema } from '#lib/server/queries/library.js';
import { libraryContent } from '#lib/server/queries/library-content.js';
import { collectionData, collectionOptionsSchema, collectionParameters } from '#lib/collection/query.server.js';
import { missingDemand } from '#lib/collection/demand.server.js';
import { profileUser } from '#lib/server/queries/profile-user.js';
import type { PageServerLoad } from './$types';
import {resolveAction,actionUrl} from '#lib/actions.js';
import { libraryBrowseDefaults, libraryTypeOptions, libraryEntityOptions } from '#lib/library.js';
import { requireEnabledCategory } from '#lib/server/experimental.js';
import { AppError } from '#lib/server/security/errors.js';

const loadLibrary = async ({ locals, url, depends, request }: Parameters<PageServerLoad>[0]) => {
  depends('coast:tracking');
  if (!locals.user) error(401, 'Sign in to browse your library.');
  const config=await getFeatureConfig(locals.user.id);
  url=actionUrl(url,locals.user.settings?.action,config);
  const parameters=url.searchParams;
  const fallback=libraryTypeOptions(config)[0];
  const view=resolveAction(parameters,locals.user.settings?.action,config);
  const entity=libraryEntityOptions(view,config);
  const defaultKind=entity[0]?.value??'all';
  if (!['overview', 'watch', 'listen', 'play', 'read'].includes(view)) error(400, 'Choose a valid library view.');
  const username = parameters.get('username') || undefined;
  const profile = username ? await profileUser(username) : null;
  const defaults = libraryBrowseDefaults(parameters, !!profile);
  const collection = defaults.collection&&!['artist','playlist'].includes(parameters.get('kind')??''), scope = defaults.scope;
  const category = view === 'listen' ? 'music' : view === 'play' ? 'game' : view === 'read' ? 'reading' : 'screen';
  if(fallback)requireEnabledCategory(config, category);
  const container=parameters.get('kind')==='series'||parameters.get('kind')==='playlist';
  const parsed = v.safeParse(collectionOptionsSchema, { ...collectionParameters(url), ...(parameters.get('kind') === 'artist'||container ? { kind: 'all' } : {}), category, level: 'root' });
  if (!parsed.success) error(400, 'Choose valid Collection filters and a positive page number.');
  const tracking = parameters.get('tracking') ?? (parsed.output.activity === 'active' ? view === 'play' ? 'in-progress' : view === 'read' ? 'reading' : 'progress' : parsed.output.activity === 'completed' && ['watch','overview'].includes(view) ? 'watched' : parsed.output.activity);
  const requestedKind=parameters.get('kind');
  const kind = !requestedKind||requestedKind==='all'?defaultKind:requestedKind;
  if(!entity.some(option=>option.value===kind))error(400,'Choose a media type for this action.');
  const genre = parameters.get('genre') ?? '';
  if (!collection && view === 'watch') {
    const libraryFilters = v.safeParse(libraryOptionsSchema, { page: parsed.output.page, sort:parsed.output.sort,segment:parsed.output.segment,tracking, scope, kind, genre });
    if (!libraryFilters.success) error(400, 'Choose valid library filters and a positive page number.');
  }
  if (!['all', 'available'].includes(scope)) error(400, 'Choose a valid availability scope.');
  const collectionFilters = v.parse(collectionOptionsSchema, { ...parsed.output, kind:container||kind==='artist'?'all':kind, ...(view === 'read' ? { activity: tracking } : {}), availability: parameters.has('scope') ? scope === 'available' ? 'available' : 'all' : parsed.output.availability });
  const browseUrl = new URL(url);
  browseUrl.searchParams.set('surface', view);
  browseUrl.searchParams.set('selection', view === 'listen' ? kind : tracking);
  browseUrl.searchParams.set('scope', scope);
  browseUrl.searchParams.set('kind',kind);
  browseUrl.searchParams.set('collection',String(collection));
  return {
    view, collection, username: profile?.username ?? null, owner: !profile || profile.id === locals.user.id,
    filters: { ...collectionFilters, genre, tracking, scope, kind },
    content: !fallback ? null : !container&&kind!=='artist'&&(collection || view==='listen'&&collectionFilters.segment!=='all')
      ? await collectionData(locals.user.id, collectionFilters, username, requestedPageInterval(collectionFilters.page,parameters.get('firstPage')),request.signal)
      : await libraryContent(locals.user.id, browseUrl,request.signal),
    missing: view !== 'read' && collection && !profile && parameters.get('missing') === 'true'
      ? missingDemand(locals.user.id, new URL(`http://coast/missing?category=${category}&page=${parameters.get('missingPage') ?? 1}`)) : null,
  };
};

export const load = (async (event) => {
  try { return await loadLibrary(event); }
  catch (cause) {
    if (cause instanceof AppError) error(cause.status, cause.message);
    if (v.isValiError(cause)) error(400, 'Choose valid Library filters.');
    throw cause;
  }
}) satisfies PageServerLoad;
