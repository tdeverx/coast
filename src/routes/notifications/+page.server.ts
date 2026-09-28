import type { PageServerLoad } from './$types';
import { inbox } from '$lib/server/notifications';
export const load = (async ({ locals }) => ({
  inbox: await inbox(locals.user, 100),
})) satisfies PageServerLoad;
