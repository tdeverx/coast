import {discoveryContent,discoveryParameters} from '$lib/server/queries/discovery';
import { mediaRows } from '$lib/server/queries/media-rows';
import type { PageServerLoad } from './$types';
import { discoverMedia } from '$lib/catalogue/service.server';
import { mediaViews } from '$lib/server/queries/media';
import { categoryEnabled, surfaceEnabled } from '$lib/experimental';
import { getConfig } from '$lib/server/config';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { READING_PROVIDER_PAGE_LIMIT } from '$lib/reading/model';
export const load = (async ({locals, depends,url}) => {
  depends('coast:tracking');
  depends('coast:reading');
  depends('coast:providers');

  let parsed;
  try { parsed=discoveryParameters(url); } catch(cause) { if(v.isValiError(cause))error(400,'Choose valid discovery filters.'); throw cause; }
  const selection={...parsed,surface:locals.user?parsed.surface:'watch' as const};
  if(locals.user && selection.surface==='read'){
    if(selection.page>READING_PROVIDER_PAGE_LIMIT)error(400,'Choose a valid discovery page.');
    const config=await getConfig();
    if(!surfaceEnabled(config,'read') || selection.kind!=='all'&&!categoryEnabled(config,selection.kind))error(404,'This reading selection is unavailable.');
  }
  const selected=locals.user&&selection.surface!=='watch'&&(url.searchParams.has('section')||selection.surface==='read')?await discoveryContent(locals.user.id,selection):undefined;
  const result = selected?{items:[],trending:[],recent:[],configured:true,providerUnavailable:false}:await discoverMedia(locals.user?.id??null);
  const items = locals.user ? await mediaViews(locals.user.id,{ids:result.items.map(i=>i.id)}) : await (await import('$lib/social/public.server')).publicMedia(result.items.map(i=>i.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  const selectItems = (ids: string[]) => ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  return {
    items,selection,selected,
    mediaRows: locals.user ? await mediaRows() : {experimentalMusic:false,experimentalGaming:false,experimentalBooks:false,experimentalComics:false,personal:false},
    trending: selectItems(result.trending),
    recent: selectItems(result.recent),
    configured: result.configured,
    providerUnavailable: result.providerUnavailable,
  };
}) satisfies PageServerLoad;
