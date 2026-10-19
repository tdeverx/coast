import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { eq } from 'drizzle-orm';
import { loadMediaDetails } from '$lib/application/media-details.server';
import { readingDetailLoad } from '$lib/reading/routes.server';
import {screenDetailChildren} from '$lib/media/detail-target';
import { getDb } from '$lib/server/db';
import { readingWorks } from '$lib/server/db/schema';

export const load = (async (event) => {
  const { locals, params, depends } = event;
  depends('coast:tracking');

  if (!v.is(v.pipe(v.string(), v.uuid()), params.id)) error(400, 'Check the media identifier.');
  const [reading] = await getDb().select({ kind: readingWorks.kind }).from(readingWorks).where(eq(readingWorks.id, params.id));
  if (reading) return { reading: await readingDetailLoad(reading.kind)(event) };

  const includeChildren=screenDetailChildren(event.url.searchParams.get('section'));
  if(!locals.user){const initial={...(await (await import('$lib/social/public.server')).publicDetails(params.id,includeChildren)),requestable:false,refreshUnavailable:false};return {...initial,enhancement:Promise.resolve(initial)};}
  return loadMediaDetails(locals.user.id, params.id, event.request.signal,includeChildren);
}) satisfies PageServerLoad;
