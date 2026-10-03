import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { searchMedia } from '$lib/catalogue/service';
import { mediaViews } from '$lib/server/queries/media';
import { getConfig } from '$lib/server/config';
import { musicRow } from '$lib/server/queries/media-rows';
import { listGames } from '$lib/core/games/service';
import { listProviders } from '$lib/providers/instances.server';
import { searchIgdb } from '$lib/providers/igdb/service.server';
import { gameCard } from '$lib/games/presentation';
import type { MediaCardPresentation } from '$lib/ui/types';
import type { PageServerLoad } from './$types';

type SearchPresentations = {
  items: MediaCardPresentation[];
  discover: MediaCardPresentation[];
  failure: string;
  truncated: boolean;
};
async function searchPresentations(
  userId: string,
  surface: string,
  query: string,
  kind: string
): Promise<SearchPresentations> {
  if (!query || surface === 'watch')
    return { items: [], discover: [], failure: '', truncated: false };
  if (surface === 'listen') {
    const result = await musicRow(userId, query, kind as 'all' | 'album' | 'artist' | 'track', 100);
    return { ...result, discover: [], truncated: result.items.length >= 100 };
  }
  const local = await listGames(query,1,{userId,personal:false});
  const sources = (await listProviders(userId)).filter(
    (source) => source.provider === 'igdb' && source.enabled && source.configured
  );
  const result = await Promise.all(
    sources.map(async (source) => {
      try {
        const response = await searchIgdb(source.id, query);
        return {
          items: response.items.map((item) =>
            gameCard(
              { ...item, id: item.externalId },
              `/games/igdb/${source.id}/${item.externalId}`
            )
          ),
          failure: '',
          truncated: response.hasMore,
        };
      } catch {
        return {
          items: [],
          failure: `Game discovery from ${source.name} is temporarily unavailable.`,
          truncated: false,
        };
      }
    })
  );
  return {
    items: local.items.map((item) => gameCard(item)),
    discover: result.flatMap((row) => row.items),
    failure: result
      .map((row) => row.failure)
      .filter(Boolean)
      .join(' '),
    truncated: local.total > local.items.length || result.some((row) => row.truncated),
  };
}
export const load: PageServerLoad = async ({locals, url, depends}) => {
  depends('coast:tracking');

  if (!locals.user) error(401, 'Sign in to search.');
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const view = v.safeParse(
    v.picklist(['all', 'watch', 'listen', 'play']),
    url.searchParams.get('view') ?? 'all'
  );
  if (!view.success) error(400, 'Choose a valid search view.');
  const enabled = (await getConfig()).experimentalFeatures;
  if (['listen', 'play'].includes(view.output) && !enabled)
    error(404, 'This search view is unavailable.');
  const items =
    query && ['all', 'watch'].includes(view.output)
      ? await mediaViews(locals.user.id, { query, availableFirst: true, limit: 101 })
      : [];
  const initial = {
    items: items.slice(0, 100),
    providerUnavailable: false,
    truncated: items.length > 100,
  };
  const empty = { items: [], discover: [], failure: '', truncated: false };
  return {
    query,
    view: view.output,
    initial,
    watch:
      query && ['all', 'watch'].includes(view.output)
        ? searchMedia(locals.user.id, query).catch(() => ({
            ...initial,
            providerUnavailable: true,
          }))
        : Promise.resolve(initial),
    listen:
      enabled && ['all', 'listen'].includes(view.output)
        ? searchPresentations(locals.user.id, 'listen', query, 'all').catch(() => ({
            ...empty,
            failure: 'Music search could not be loaded. Please try again.',
          }))
        : Promise.resolve(empty),
    play:
      enabled && ['all', 'play'].includes(view.output)
        ? searchPresentations(locals.user.id, 'play', query, 'all').catch(() => ({
            ...empty,
            failure: 'Game search could not be loaded. Please try again.',
          }))
        : Promise.resolve(empty),
  };
};
