import {librarySortValues,librarySegmentValues} from '#lib/library.js';
import { PAGE_SIZE, requestedPageInterval } from './pagination';
import { getFeatureConfig } from '#lib/server/features.js';
import * as v from 'valibot';
import { requireExperimentalFeature } from '#lib/server/experimental.js';
import { libraryData } from './library';
import { presentationContent } from './media-rows';
import { listGames } from '#lib/core/games/service.server.js';
import { gameCard } from '#lib/games/presentation.js';
import { musicBrowseData } from './music';
import type { LibraryContent } from '#lib/library.js';
import { readingCatalogue, readingCards } from '#lib/reading/query.server.js';

export async function libraryContent(userId: string, url: URL,signal?:AbortSignal): Promise<LibraryContent> {
  signal?.throwIfAborted();
  if (url.searchParams.get('preview') === 'true') {
    const result = await presentationContent(userId, url,signal);
    return { ...result, page: 1, pages: 1, total: result.items.length };
  }
  const surface = v.parse(
    v.picklist(['watch', 'listen', 'play', 'read']),
    url.searchParams.get('surface') ?? 'watch'
  );
  const segment=v.parse(v.picklist(librarySegmentValues),url.searchParams.get('segment')??'all');
  const sort=v.parse(v.picklist(librarySortValues),url.searchParams.get('sort')??'default');
  const selection = url.searchParams.get('selection') ?? 'all';
  const page = Number(url.searchParams.get('page') ?? 1);
  const interval = requestedPageInterval(page, url.searchParams.get('firstPage'));
  if (surface === 'watch')
    return libraryData(userId, {
      sort,segment,
      kind: url.searchParams.get('kind') ?? 'all',
      scope: url.searchParams.get('scope') ?? 'available',
      tracking: selection,
      genre: url.searchParams.get('genre') ?? '',
      page,
    }, interval?.firstPage, signal);
  if (surface === 'read') {
    const result = await readingCatalogue(userId, {
      sort,segment,
      kind: url.searchParams.get('kind') ?? 'all', state: selection, personal: false, available: v.parse(v.picklist(['all','available']),url.searchParams.get('scope')??'all')==='available',
      page,
    }, interval?.firstPage);
    const items: LibraryContent['items'] = [], counts: number[] = [];
    for (let number=result.range?.firstPage ?? result.page;number<=result.page;number++) {
      signal?.throwIfAborted();
      const offset=(number-(result.range?.firstPage ?? result.page))*PAGE_SIZE;
      const cards=await readingCards(userId,userId,result.items.slice(offset,offset+PAGE_SIZE));
      signal?.throwIfAborted();
      items.push(...cards); counts.push(cards.length);
    }
    return { ...result, items, ...(result.range ? {range:{...result.range,counts}} : {}) };
  }
  requireExperimentalFeature(await getFeatureConfig(userId), surface === 'listen' ? 'music' : 'gaming');
  if (surface === 'listen') {
    const musicUrl = new URL(url);
    musicUrl.searchParams.set('kind', selection);
    const result = await musicBrowseData(userId, musicUrl,signal);
    return {
      items: result.items,
      ...(result.range ? {range:result.range} : {}),
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
  const scope = v.parse(v.picklist(['all', 'available']), url.searchParams.get('scope') ?? 'available');
  const result = await listGames('', page, {userId,sort,segment,personal:false,availableOnly:scope==='available',...(state==='all'?{}:{status:state})}, PAGE_SIZE, interval?.firstPage);
  return {...result,items:result.items.map(item => gameCard(item))};
}
