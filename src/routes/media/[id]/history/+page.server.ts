import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { requireUser } from '$lib/server/auth';
import { mediaViewsForIds } from '$lib/server/queries/media';
import { mediaActivity } from '$lib/server/queries/media-actions';

export const load: PageServerLoad = async ({locals, params, url, depends}) => {
  depends('coast:tracking');

  const user = requireUser(locals.user);
  if (!v.is(v.pipe(v.string(), v.uuid()), params.id)) error(404, 'Title not found.');
  const [item] = await mediaViewsForIds(user.id, [params.id]);
  if (!item) error(404, 'Title not found.');
  return {
    item,
    selecting: url.searchParams.get('remove') === '1',
    activity: await mediaActivity(user.id, item.id),
    historySnapshot: new Date().toISOString(),
    today: new Date().toISOString().slice(0, 10),
  };
};
