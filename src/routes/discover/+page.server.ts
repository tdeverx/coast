import { mediaRows } from '$lib/server/queries/media-rows';
import type { PageServerLoad } from './$types';
import { discoverMedia } from '$lib/catalogue/service';
import { mediaViews } from '$lib/server/queries/media';
export const load = (async ({ locals }) => {
  const result = await discoverMedia(locals.user?.id??null);
  const items = locals.user ? await mediaViews(locals.user.id,{ids:result.items.map(i=>i.id)}) : await (await import('$lib/social/public.server')).publicMedia(result.items.map(i=>i.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  const selectItems = (ids: string[]) => ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  return {
    items,
    mediaRows: locals.user ? await mediaRows() : {enabled:false,personal:false},
    trending: selectItems(result.trending),
    recent: selectItems(result.recent),
    configured: result.configured,
    providerUnavailable: result.providerUnavailable,
  };
}) satisfies PageServerLoad;
