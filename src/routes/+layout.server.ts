import type { LayoutServerLoad } from './$types';
import { inbox } from '$lib/server/notifications';
export const load = (async ({ locals, depends }) => {
  depends('coast:session');
  return {
    user: locals.user,
    expiresAt: locals.expiresAt?.toISOString() ?? null,
    notifications: locals.user ? await inbox(locals.user) : [],
  };
}) satisfies LayoutServerLoad;
