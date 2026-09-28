import { error } from '@sveltejs/kit';
import { searchMedia } from '$lib/catalogue/service';
import { mediaViews } from '$lib/server/queries/media';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) error(401, 'Sign in to search.');
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const items = query
    ? await mediaViews(locals.user.id, { query, availableFirst: true, limit: 101 })
    : [];
  const initial = {
    items: items.slice(0, 100),
    providerUnavailable: false,
    truncated: items.length > 100,
  };
  const enhancement = query
    ? searchMedia(locals.user.id, query).catch(() => ({ ...initial, providerUnavailable: true }))
    : Promise.resolve(initial);
  return { query, ...initial, enhancement };
};
