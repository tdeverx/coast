import { mediaRows } from '$lib/server/queries/media-rows';
import type { PageServerLoad } from './$types';
import { discoverMedia } from '$lib/catalogue/service';
import { mediaViews } from '$lib/server/queries/media';
export const load = (async ({ locals }) => {
  const result = await discoverMedia(locals.user?.id??null);
  const items = locals.user ? await mediaViews(locals.user.id,{ids:result.items.map(i=>i.id)}) : await (await import('$lib/social/public.server')).publicMedia(result.items.map(i=>i.id));
  return {
    items,
    mediaRows: locals.user ? await mediaRows() : {enabled:false,personal:false},
    trending: result.trending.flatMap((id) =>
      items.find((m) => m.id === id) ? [items.find((m) => m.id === id)!] : []
    ),
    recent: result.recent.flatMap((id) =>
      items.find((m) => m.id === id) ? [items.find((m) => m.id === id)!] : []
    ),
    configured: result.configured,
    providerUnavailable: result.providerUnavailable,
  };
}) satisfies PageServerLoad;
