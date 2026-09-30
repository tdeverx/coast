import { error } from '@sveltejs/kit';
import { musicBrowseData } from '$lib/server/queries/music';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) error(401, 'Sign in to browse music.');
  return musicBrowseData(locals.user.id, url);
};
