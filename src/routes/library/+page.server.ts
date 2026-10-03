import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { libraryOptionsSchema } from '$lib/server/queries/library';
import { libraryContent } from '$lib/server/queries/library-content';
import { collectionData, collectionOptionsSchema, collectionParameters } from '$lib/collection/query.server';
import { missingDemand } from '$lib/collection/demand.server';
import { profileUser } from '$lib/server/queries/profile-user';
import type { PageServerLoad } from './$types';
import { libraryBrowseDefaults } from '$lib/library';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  depends('coast:tracking');
  if (!locals.user) error(401, 'Sign in to browse your library.');
  const parameters = url.searchParams;
  const view = parameters.get('view') ?? (parameters.get('genre') ? 'watch' : 'overview');
  if (!['overview', 'watch', 'listen', 'play'].includes(view)) error(400, 'Choose a valid library view.');
  const username = parameters.get('username') || undefined;
  const profile = username ? await profileUser(username) : null;
  const { collection, scope } = libraryBrowseDefaults(parameters, !!profile);
  const category = view === 'listen' ? 'music' : view === 'play' ? 'game' : 'screen';
  const parsed = v.safeParse(collectionOptionsSchema, { ...collectionParameters(url), ...(!collection && parameters.get('kind') === 'artist' ? { kind: 'all' } : {}), category, level: 'root' });
  if (!parsed.success) error(400, 'Choose valid Collection filters and a positive page number.');
  const tracking = parameters.get('tracking') ?? (parsed.output.activity === 'active' ? view === 'play' ? 'in-progress' : 'progress' : parsed.output.activity === 'completed' && view !== 'play' ? 'watched' : parsed.output.activity);
  const kind = parameters.get('kind') ?? 'all';
  const genre = parameters.get('genre') ?? '';
  if (!collection && (view === 'overview' || view === 'watch')) {
    const libraryFilters = v.safeParse(libraryOptionsSchema, { page: parsed.output.page, tracking, scope, kind, genre });
    if (!libraryFilters.success) error(400, 'Choose valid library filters and a positive page number.');
  }
  if (!['all', 'available'].includes(scope)) error(400, 'Choose a valid availability scope.');
  const collectionFilters = { ...parsed.output, availability: parameters.has('scope') ? scope === 'available' ? 'available' as const : 'all' as const : parsed.output.availability };
  const browseUrl = new URL(url);
  browseUrl.searchParams.set('surface', view === 'overview' ? 'watch' : view);
  browseUrl.searchParams.set('selection', view === 'listen' ? kind : tracking);
  browseUrl.searchParams.set('scope', scope);
  return {
    view, collection, username: profile?.username ?? null, owner: !profile || profile.id === locals.user.id,
    filters: { ...collectionFilters, genre, tracking, scope, kind },
    content: view === 'overview' ? null : collection
      ? await collectionData(locals.user.id, collectionFilters, username)
      : await libraryContent(locals.user.id, browseUrl),
    missing: collection && !profile && parameters.get('missing') === 'true'
      ? missingDemand(locals.user.id, new URL(`http://coast/missing?page=${parameters.get('missingPage') ?? 1}`)) : null,
  };
};
