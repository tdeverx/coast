import type { PageServerLoad } from './$types';
import { homeData } from '$lib/server/queries/home';
export const load = (async ({ locals, depends }) => {
  depends('coast:tracking', 'coast:social');
  return await homeData(locals.user!.id); }) satisfies PageServerLoad;
