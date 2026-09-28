import type { PageServerLoad } from './$types';
import { homeData } from '$lib/server/queries/home';
export const load = (async ({ locals }) => homeData(locals.user!.id)) satisfies PageServerLoad;
