import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { persistScreenListings } from '#lib/catalogue/service.server.js';
import { discoveryScreenCards } from '#lib/server/queries/discovery.js';
import { providerGameCards } from '#lib/games/presentation.server.js';
import { readingProviderCards } from '#lib/reading/query.server.js';
import { AppError } from '#lib/server/security/errors.js';
import type { MediaView, MediaCardPresentation } from '#lib/ui/types.js';
import { screenListings, releaseWindow } from '#lib/providers/screen-discovery.server.js';
import { igdbSource } from '#lib/providers/igdb/service.server.js';
import type { IgdbGame } from '#lib/providers/igdb/adapter.server.js';
import { browseBooks, upcomingComics } from '#lib/providers/reading.server.js';
import type { BrowseVariant, DynamicKind } from './model';
import { getProviderGenre } from './row-catalog';
import { providerRowCache } from './provider-read.server';

const games = providerRowCache<IgdbGame[]>();
type RowCard = MediaView | MediaCardPresentation;

export async function providerCards(userId: string | null, kind: DynamicKind, variant: BrowseVariant, genre: string | undefined,
  signal: AbortSignal, igdbId?: string): Promise<RowCard[]> {
  const order = variant==='provider-rated'?'rated':variant==='provider-upcoming'?'upcoming':'popular';
  if (kind==='movie' || kind==='show') {
    const result = await screenListings(kind,order,genre,signal);
    if (!result.items.length && result.failed) throw new AppError(502,'Discovery providers could not load this row. Try again.','discovery_unavailable');
    const ids = await persistScreenListings(result.items,signal);
    return discoveryScreenCards(userId,ids);
  }
  if (!userId) return [];
  const tag = getProviderGenre(genre);
  const dates = releaseWindow();
  if (kind==='game' && igdbId) {
    const source = await igdbSource(igdbId);
    const key = JSON.stringify([source.cacheScope,variant,genre,dates.today]);
    const from = Date.parse(dates.from)/1000;
    const through = Date.parse(order==='upcoming'?dates.through:dates.today)/1000+86399;
    const matches = await games(key,signal,upstream=>source.adapter.browse(order,from,through,tag?.game,upstream));
    signal.throwIfAborted();
    return providerGameCards(userId,matches.map(item=>({...item,instanceId:igdbId})));
  }
  if (kind==='book' && tag?.book) return readingProviderCards(userId,await browseBooks(tag.book,signal));
  if (kind==='comic') return readingProviderCards(userId,await upcomingComics(dates.from,dates.through,signal));
  return [];
}

/** Exclude previously handled canonical results. Provider previews have no
 * local history, and member exclusions never enter the shared metadata cache. */
export async function unseenProviderCards(userId: string, items: RowCard[]) {
  const workId = (item: RowCard) => 'href' in item ? item.workId : item.id;
  const ids = items.flatMap(item=>{const id=workId(item);return id?[id]:[];});
  if (!ids.length) return items;
  const seen = await getDb().execute<{id:string}>(sql`
    select w.id from works w where w.id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `)}) and (
      exists (select 1 from tracking_state t where t.media_id=w.id and t.user_id=${userId}
        and (t.watched or t.dropped or t.watchlist or t.collected or t.favourite))
      or exists (select 1 from ratings r where r.media_id=w.id and r.user_id=${userId} and r.value<2.5)
      or exists (select 1 from reading_progress p where p.work_id=w.id and p.user_id=${userId})
      or exists (select 1 from game_playthroughs p where p.game_id=w.id and p.user_id=${userId} and p.status in ('completed','dropped','in-progress')))
  `);
  const excluded = new Set(seen.map(row=>row.id));
  return items.filter(item=>!excluded.has(workId(item)??''));
}
