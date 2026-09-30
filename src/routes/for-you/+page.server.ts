import { mediaRows } from '$lib/server/queries/media-rows';
import type { PageServerLoad } from './$types';
import { homeData } from '$lib/server/queries/home';
export const load = (async ({ locals }) => ({
  ...(await homeData(locals.user!.id)),
  mediaRows: await mediaRows(locals.user!.id, true),
})) satisfies PageServerLoad;
