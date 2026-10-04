import type { PageServerLoad } from './$types';
import { homeData } from '$lib/server/queries/home';
export const load = (async ({ locals, depends, url }) => {
  depends('coast:tracking', 'coast:social');
  return url.searchParams.get('section') ? { hero: null, heroNext: null } : await homeData(locals.user!.id);
}) satisfies PageServerLoad;
