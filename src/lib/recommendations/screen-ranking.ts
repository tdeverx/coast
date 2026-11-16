import type { Metadata } from '#lib/providers/contracts.js';

export function screenListingIds(item: Metadata) {
  const aliases = {...item.externalIds,[item.provider]:item.externalId};
  // Only known provider identities are used for resolution. Seerr's numeric ID
  // is TMDB's; it does not contribute a second independent ranking vote.
  return Object.entries(aliases).filter(([provider,id]) => provider === 'imdb' ? /^tt[0-9]+$/.test(id)
    : ['tmdb','trakt','tvdb'].includes(provider) && /^[1-9][0-9]{0,15}$/.test(id));
}

export function mergeScreenRankings(lists: readonly Metadata[][], order: 'rank' | 'latest' | 'soonest' = 'rank') {
  const byIdentity = new Map<string,{item:Metadata; ranks:Map<string,number>}>();
  for (const list of lists) list.forEach((item, rank) => {
    const aliases = screenListingIds(item);
    if (!aliases.length) return;
    const [provider,id] = aliases.find(([source])=>source==='tmdb') ?? aliases.find(([source])=>source===item.provider) ?? aliases[0];
    const key = `${item.kind}:${provider}:${id}`;
    const channel = item.provider === 'seerr' ? 'tmdb' : item.provider;
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key,{item:{...item,externalIds:Object.fromEntries(aliases)},ranks:new Map([[channel,rank]])});
      return;
    }
    existing.ranks.set(channel,Math.min(existing.ranks.get(channel) ?? rank, rank));
    // The preferred source leads; another source fills missing fields and
    // contributes verified aliases for reuse of existing catalogue works.
    const preferred = existing.item;
    existing.item = {...preferred, externalIds:{...Object.fromEntries(aliases),...preferred.externalIds},
      overview:preferred.overview || item.overview, releaseDate:preferred.releaseDate || item.releaseDate,
      posterPath:preferred.posterPath || item.posterPath, backdropPath:preferred.backdropPath || item.backdropPath,
      genres:preferred.genres?.length ? preferred.genres : item.genres, runtimeMinutes:preferred.runtimeMinutes ?? item.runtimeMinutes};
  });
  const weight = ({ranks}: {ranks:Map<string,number>}) => [...ranks.values()].reduce((total,rank)=>total+1/(10+rank),0);
  return [...byIdentity.values()].sort((a,b) => {
    const aDate=a.item.releaseDate, bDate=b.item.releaseDate;
    const dateOrder=aDate && bDate ? aDate.localeCompare(bDate)*(order==='latest'?-1:1) : Number(!aDate)-Number(!bDate);
    return (order==='rank'?0:dateOrder) || weight(b)-weight(a);
  }).map(entry=>entry.item);
}
