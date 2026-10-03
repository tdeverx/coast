import {discoveryContent,discoveryParameters} from '$lib/server/queries/discovery';
import { mediaRows } from '$lib/server/queries/media-rows';
import type { PageServerLoad } from './$types';
import { discoverMedia } from '$lib/catalogue/service';
import { mediaViews } from '$lib/server/queries/media';
export const load = (async ({locals, depends,url}) => {
  depends('coast:tracking');

  const parsed=discoveryParameters(url);
  const selection={...parsed,surface:locals.user?parsed.surface:'watch' as const};
  const selected=url.searchParams.has('section')&&locals.user&&selection.surface!=='watch'?await discoveryContent(locals.user.id,selection):undefined;
  const result = selected?{items:[],trending:[],recent:[],configured:true,providerUnavailable:false}:await discoverMedia(locals.user?.id??null);
  const items = locals.user ? await mediaViews(locals.user.id,{ids:result.items.map(i=>i.id)}) : await (await import('$lib/social/public.server')).publicMedia(result.items.map(i=>i.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  const selectItems = (ids: string[]) => ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  return {
    items,selection,selected,
    mediaRows: locals.user ? await mediaRows() : {experimentalMusic:false,experimentalGaming:false,personal:false},
    trending: selectItems(result.trending),
    recent: selectItems(result.recent),
    configured: result.configured,
    providerUnavailable: result.providerUnavailable,
  };
}) satisfies PageServerLoad;
