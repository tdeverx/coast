import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { libraryData, libraryOptionsSchema } from '$lib/server/queries/library';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) error(401, 'Sign in to browse your library.');
  const parameters = url.searchParams;
  const view =
    parameters.get('view') ??
    (parameters.has('genre') && parameters.get('genre') ? 'watch' : 'overview');
  if (!['overview', 'watch'].includes(view)) error(400, 'Choose a valid library view.');
  const parsed = v.safeParse(libraryOptionsSchema, {
    page: parameters.has('page') ? Number(parameters.get('page')) : undefined,
    genre: parameters.get('genre') ?? undefined,
    kind: parameters.get('kind') ?? undefined,
    scope: parameters.get('scope') ?? undefined,
    tracking: parameters.get('tracking') ?? undefined,
  });
  if (!parsed.success) error(400, 'Choose valid library filters and a positive page number.');
  return {
    view,
    filters: parsed.output,
    content: view === 'watch' ? await libraryData(locals.user.id, parsed.output) : null,
  };
};
