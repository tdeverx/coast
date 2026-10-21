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
import { libraryBrowseDefaults } from '#lib/library.js';
import { requireEnabledCategory } from '#lib/server/experimental.js';
import { AppError } from '#lib/server/security/errors.js';

const loadLibrary = async ({ locals, url, depends, request }: Parameters<PageServerLoad>[0]) => {
  depends('coast:tracking');
  if (!locals.user) error(401, 'Sign in to browse your library.');
  const parameters = url.searchParams;
  const view = parameters.get('view') ?? (parameters.get('genre') ? 'watch' : 'overview');
  if (!['overview', 'watch', 'listen', 'play', 'read'].includes(view)) error(400, 'Choose a valid library view.');
  const username = parameters.get('username') || undefined;
  const profile = username ? await profileUser(username) : null;
  const defaults = libraryBrowseDefaults(parameters, !!profile);
  const collection = defaults.collection, scope = defaults.scope;
  const category = view === 'listen' ? 'music' : view === 'play' ? 'game' : view === 'read' ? 'reading' : 'screen';
  if (view !== 'overview') requireEnabledCategory(await getFeatureConfig(locals.user?.id??null), category);
  const parsed = v.safeParse(collectionOptionsSchema, { ...collectionParameters(url), ...(!collection && parameters.get('kind') === 'artist' ? { kind: 'all' } : {}), category, level: 'root' });
  if (!parsed.success) error(400, 'Choose valid Collection filters and a positive page number.');
  const tracking = parameters.get('tracking') ?? (parsed.output.activity === 'active' ? view === 'play' ? 'in-progress' : view === 'read' ? 'reading' : 'progress' : parsed.output.activity === 'completed' && ['watch','overview'].includes(view) ? 'watched' : parsed.output.activity);
  const kind = parameters.get('kind') ?? 'all';
  const genre = parameters.get('genre') ?? '';
  if (!collection && (view === 'overview' || view === 'watch')) {
    const libraryFilters = v.safeParse(libraryOptionsSchema, { page: parsed.output.page, tracking, scope, kind, genre });
    if (!libraryFilters.success) error(400, 'Choose valid library filters and a positive page number.');
  }
  if (!['all', 'available'].includes(scope)) error(400, 'Choose a valid availability scope.');
  const collectionFilters = v.parse(collectionOptionsSchema, { ...parsed.output, ...(view === 'read' ? { activity: tracking } : {}), availability: parameters.has('scope') ? scope === 'available' ? 'available' : 'all' : parsed.output.availability });
  const browseUrl = new URL(url);
  browseUrl.searchParams.set('surface', view === 'overview' ? 'watch' : view);
  browseUrl.searchParams.set('selection', view === 'listen' ? kind : tracking);
  browseUrl.searchParams.set('scope', scope);
  return {
    view, collection, username: profile?.username ?? null, owner: !profile || profile.id === locals.user.id,
    filters: { ...collectionFilters, genre, tracking, scope, kind },
    content: view === 'overview' ? null : collection
      ? await collectionData(locals.user.id, collectionFilters, username, requestedPageInterval(collectionFilters.page,parameters.get('firstPage')),request.signal)
      : await libraryContent(locals.user.id, browseUrl,request.signal),
    missing: collection && !profile && parameters.get('missing') === 'true'
      ? missingDemand(locals.user.id, new URL(`http://coast/missing?page=${parameters.get('missingPage') ?? 1}`)) : null,
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
