import * as v from 'valibot';
import { getConfig } from '$lib/server/config';
import { requireExperimentalFeatures } from '$lib/server/experimental';
import { libraryData } from './library';
import { presentationContent } from './media-rows';
import { musicBrowseData } from './music';
import type { LibraryContent } from '$lib/library';

export async function libraryContent(userId: string, url: URL): Promise<LibraryContent> {
  if (url.searchParams.get('preview') === 'true') {
    if(url.searchParams.get('surface')==='play')return {items:[],page:1,pages:1,total:0,failure:'No game availability source is connected. Tracked games are in Collection.'};
    const result = await presentationContent(userId, url);
    return { ...result, page: 1, pages: 1, total: result.items.length };
  }
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
      items: result.items,
      page: result.page,
      pages: result.pages,
      total: result.total,
      failure: result.failure,
    };
  }
  v.parse(
    v.picklist(['all', 'planned', 'in-progress', 'completed', 'paused', 'dropped']),
    selection
  );
  return {items:[],page:1,pages:1,total:0,failure:'No game availability source is connected. Tracked games are in Collection.'};
}
