import * as v from 'valibot';
import { getConfig } from '$lib/server/config';
import { requireExperimentalFeatures } from '$lib/server/experimental';
import { libraryData } from './library';
import { musicBrowseData } from './music';
import { listGames } from '$lib/core/games/service';
import { gameCard } from '$lib/games/presentation';
import { musicCard } from '$lib/music/presentation';
import type { LibraryContent } from '$lib/library';

export async function libraryContent(userId: string, url: URL): Promise<LibraryContent> {
  const surface = v.parse(
    v.picklist(['watch', 'listen', 'play']),
    url.searchParams.get('surface') ?? 'watch'
  );
  const selection = url.searchParams.get('selection') ?? 'all';
  if (surface === 'watch')
    return libraryData(userId, {
      kind: url.searchParams.get('kind') ?? 'all',
      scope: url.searchParams.get('scope') ?? 'available',
      tracking: selection,
      genre: url.searchParams.get('genre') ?? '',
      page: Number(url.searchParams.get('page') ?? 1),
    });
  requireExperimentalFeatures(await getConfig());
  if (surface === 'listen') {
    const musicUrl = new URL(url);
    musicUrl.searchParams.set('kind', selection);
    const result = await musicBrowseData(userId, musicUrl);
    return {
      items: result.items.map((item) => musicCard(item, result.connectionId)),
      page: result.page,
      pages: result.pages,
      total: result.total,
      failure: result.failure,
    };
  }
  const state = v.parse(
    v.picklist(['all', 'planned', 'in-progress', 'completed', 'paused', 'dropped']),
    selection
  );
  const result = await listGames(
    '',
    Number(url.searchParams.get('page') ?? 1),
    state === 'all' ? undefined : { userId, status: state }
  );
  return { ...result, items: result.items.map((item) => gameCard(item)) };
}
