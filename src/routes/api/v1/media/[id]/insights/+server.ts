import { json, error } from '@sveltejs/kit';
import { titleInsights } from '$lib/catalogue/details.server';
export const GET = async ({ locals, params, url }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) error(400, 'Invalid title.');
  const source = url.searchParams.get('source') ?? 'tmdb';
  if (!['tmdb', 'trakt'].includes(source)) error(400, 'Invalid rating source.');
  const page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 500) error(400, 'Invalid page.');
  try {
    return json(await titleInsights(locals.user!.id, params.id, source, page));
  } catch {
    return json(
      { error: `${source === 'tmdb' ? 'TMDB' : 'Trakt'} details are temporarily unavailable.` },
      { status: 503 }
    );
  }
};
