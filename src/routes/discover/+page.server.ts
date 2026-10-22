import {resolveAction,actionUrl} from '#lib/actions.js';
import { getFeatureConfig } from '#lib/server/features.js';
import {discoveryContent,discoveryParameters} from '#lib/server/queries/discovery.js';
import { mediaRows } from '#lib/server/queries/media-rows.js';
import type { PageServerLoad } from './$types';
import { discoverMedia } from '#lib/catalogue/service.server.js';
import { mediaViews } from '#lib/server/queries/media.js';
import { categoryEnabled, surfaceEnabled } from '#lib/experimental.js';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { READING_PROVIDER_PAGE_LIMIT } from '#lib/reading/model.js';
export const load = (async ({locals, depends,url,request}) => {
  depends('coast:tracking');
  depends('coast:reading');
  depends('coast:providers');

  const featureConfig=await getFeatureConfig(locals.user?.id??null);
  if(locals.user)url=actionUrl(url,locals.user.settings?.action,featureConfig);
  const action=locals.user?resolveAction(url.searchParams,locals.user.settings?.action,featureConfig):'watch';
  const scopedUrl=new URL(url);scopedUrl.searchParams.set('surface',action);
  let parsed;
  try { parsed=discoveryParameters(scopedUrl); } catch(cause) { if(v.isValiError(cause))error(400,'Choose valid discovery filters.'); throw cause; }
  const selection={...parsed,surface:locals.user?parsed.surface:'watch' as const};
  if(locals.user && selection.surface==='read'){
    if(selection.page>READING_PROVIDER_PAGE_LIMIT)error(400,'Choose a valid discovery page.');
    const config=await getFeatureConfig(locals.user?.id??null);
    if(!surfaceEnabled(config,'read') || selection.kind!=='all'&&!categoryEnabled(config,selection.kind))error(404,'This reading selection is unavailable.');
  }
  const selected=locals.user&&selection.surface!=='watch'&&url.searchParams.has('section')?await discoveryContent(locals.user.id,selection,request.signal):undefined;
  const result = selected||action!=='watch'||!featureConfig.features.screen?{items:[],trending:[],recent:[],configured:true,providerUnavailable:false}:await discoverMedia(locals.user?.id??null);
  const items = !result.items.length?[]:locals.user ? await mediaViews(locals.user.id,{ids:result.items.map(i=>i.id)}) : await (await import('#lib/social/public.server.js')).publicMedia(result.items.map(i=>i.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  const selectItems = (ids: string[]) => ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  return {
    items,selection,selected,
    mediaRows: locals.user ? await mediaRows(false, locals.user.id) : {experimentalMusic:false,experimentalGaming:false,experimentalBooks:false,experimentalComics:false,personal:false},
    trending: selectItems(result.trending),
    recent: selectItems(result.recent),
    configured: result.configured,
    providerUnavailable: result.providerUnavailable,
  };
}) satisfies PageServerLoad;
