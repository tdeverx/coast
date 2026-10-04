import type { PageServerLoad } from './$types';
import { loadMediaDetails } from '$lib/application/media-details.server';

export const load = (async ({locals, params, depends}) => {
  depends('coast:tracking');

  if(!locals.user){const initial={...(await (await import('$lib/social/public.server')).publicDetails(params.id)),requestable:false,refreshUnavailable:false};return {...initial,enhancement:Promise.resolve(initial)};}
  return loadMediaDetails(locals.user.id, params.id);
}) satisfies PageServerLoad;
