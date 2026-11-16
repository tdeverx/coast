import { getTmdb } from './tmdb/connection.server';
import { getTraktCommunity } from './trakt/connection.server';
import type { DiscoverKind, Metadata } from './contracts';
import { providerRowCache } from '#lib/recommendations/provider-read.server.js';
import { mergeScreenRankings } from '#lib/recommendations/screen-ranking.js';
import { getProviderGenre } from '#lib/recommendations/row-catalog.js';

const read = providerRowCache<Metadata[]>();
export const releaseWindow = (now = new Date()) => ({
  today:now.toISOString().slice(0,10),
  from:new Date(now.getTime()+86400000).toISOString().slice(0,10),
  through:new Date(now.getTime()+90*86400000).toISOString().slice(0,10),
});

/** The provider credentials resolve before cache admission. No viewer identity
 * or personal seed goes to either public listing endpoint. */
export async function screenListings(kind: DiscoverKind | 'all', order: 'trending' | 'recent' | 'popular' | 'rated' | 'upcoming',
  genre: string | undefined, signal: AbortSignal) {
  const {today,from,through} = releaseWindow();
  const tag = getProviderGenre(genre);
  const results = await Promise.allSettled([
    (async () => {
      const source = await getTmdb();
      if (!source) return null;
      const key = JSON.stringify(['tmdb',source.cacheScope,kind,order,genre,order==='upcoming'?today:'']);
      return read(key,signal,async upstream => {
        if (order==='trending') return (await source.trending(1,upstream)).slice(0,20);
        if (order==='recent') return (await source.recent(kind==='all'?'movie':kind,1,upstream)).slice(0,20);
        if (kind==='all') return [];
        return source.browse(kind,order,from,order==='upcoming'?through:today,tag?.[kind],upstream);
      });
    })(),
    (async () => {
      if (order==='rated' || order==='recent') return null;
      const source = await getTraktCommunity();
      if (!source || (tag && !tag.trakt)) return null;
      const key = JSON.stringify(['trakt',source.cacheScope,kind,order,genre,order==='upcoming'?today:'']);
      const method = order==='upcoming'?'anticipated':order;
      return read(key,signal,async upstream => kind==='all'
        ? (await Promise.all((['movie','show'] as const).map(type=>source.adapter.browse(type,method,tag?.trakt,upstream)))).flat().slice(0,40)
        : source.adapter.browse(kind,method,tag?.trakt,upstream));
    })(),
  ]);
  signal.throwIfAborted();
  const lists = results.flatMap(result=>result.status==='fulfilled'&&result.value?[result.value]:[]);
  const items = mergeScreenRankings(lists,order==='upcoming'?'soonest':order==='recent'?'latest':'rank')
    .filter(item => order==='upcoming' ? item.releaseDate && item.releaseDate>=from && item.releaseDate<=through
      : !item.releaseDate || item.releaseDate<=today);
  return {items,configured:lists.length>0 || results.some(result=>result.status==='rejected'),
    failed:results.some(result=>result.status==='rejected')};
}
