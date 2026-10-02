import type { LayoutServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { inbox } from '$lib/server/notifications';
export const load = (async ({ locals, depends }) => {
  depends('coast:session', 'coast:notifications');
  const config=await getConfig();
  return {
    publicRead:config.siteAccess==='public-read-only',
    experimentalFeatures: config.experimentalFeatures,
    user: locals.user,
    expiresAt: locals.expiresAt?.toISOString() ?? null,
    notifications: locals.user ? await inbox(locals.user) : [],
  };
}) satisfies LayoutServerLoad;
