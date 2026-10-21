import { personaliseWorkCards } from '#lib/catalogue/overrides/presentation.server.js';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import { gameExternalIds, games } from '#lib/server/db/schema.js';
import { ownedGameAvailable } from './availability.server';
import { gameCard, type GameMetadata } from './presentation';

/** Resolve bounded provider cards locally; search/discovery never import per-card metadata. */
export async function providerGameCards(userId: string, items: (GameMetadata & {externalId:string;instanceId:string})[]) {
  const ids=[...new Set(items.map(item=>item.externalId))];
  const local=ids.length?await getDb().select({game:games,available:ownedGameAvailable(userId),externalId:gameExternalIds.externalId})
    .from(games).innerJoin(gameExternalIds,and(eq(gameExternalIds.gameId,games.id),eq(gameExternalIds.provider,'igdb')))
    .where(inArray(gameExternalIds.externalId,ids)):[];
  const known=new Map(local.map(row=>[row.externalId,row]));
  const cards=items.map(item=>{const saved=known.get(item.externalId);return saved
    ?gameCard({...saved.game,available:saved.available})
    :gameCard({...item,id:`igdb:${item.externalId}`},`/games/igdb/${item.instanceId}/${item.externalId}`, false);});
  return personaliseWorkCards(userId,[...new Map(cards.map(card=>[card.id,card])).values()]);
}
