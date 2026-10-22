import {resolveAction,actionUrl} from '#lib/actions.js';
import {getFeatureConfig} from '#lib/server/features.js';
import type { PageServerLoad } from './$types';
import { homeData } from '#lib/server/queries/home.js';
import {activityFiltersSchema} from '#lib/social/model.js';
import * as v from 'valibot';
import {error} from '@sveltejs/kit';
export const load = (async ({ locals, depends, url }) => {
  depends('coast:tracking', 'coast:social');
  const config=await getFeatureConfig(locals.user!.id);
  url=actionUrl(url,locals.user!.settings?.action,config);
  const action=resolveAction(url.searchParams,locals.user!.settings?.action,config);
  const filters=v.safeParse(activityFiltersSchema,url.searchParams.get('section')==='activity'?{...Object.fromEntries(url.searchParams),audience:url.searchParams.get('audience')??'friends'}:{audience:'friends'});
  if(!filters.success)error(400,'Choose valid Activity filters.');
  return {action,activityFilters:filters.output,...(url.searchParams.get('section')||action!=='watch'?{heroes:[],heroNext:null}:await homeData(locals.user!.id))};
}) satisfies PageServerLoad;
