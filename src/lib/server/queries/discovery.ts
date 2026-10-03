import { and, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { games, gameExternalIds, providerInstances } from '$lib/server/db/schema';
import { getConfig } from '$lib/server/config';
import { requireExperimentalFeatures } from '$lib/server/experimental';
import { AppError } from '$lib/server/security/errors';
import { discoverIgdb } from '$lib/providers/igdb/service.server';
import { gameCard } from '$lib/games/presentation';
import { ownedGameAvailable } from '$lib/games/availability.server';
import { workCards } from '$lib/collection/query.server';
import { discoverMedia } from '$lib/catalogue/service';
import { mediaViews } from './media';
import type { DiscoveryContent, DiscoverySection, DiscoverySurface } from '$lib/discovery';
export async function discoveryContent(userId:string,raw:unknown):Promise<DiscoveryContent>{
  const input=v.parse(v.object({surface:v.picklist(['watch','play','listen']),section:v.picklist(['trending','recent'])}),raw);
  if(input.surface!=='watch')requireExperimentalFeatures(await getConfig());
  return input.surface==='watch'?screenDiscovery(userId,input.section):input.surface==='play'?gameDiscovery(userId,input.section):musicDiscovery(userId,input.section);
}
async function screenDiscovery(userId:string,section:DiscoverySection):Promise<DiscoveryContent>{
  const data=await discoverMedia(userId);
  const ids=section==='recent'?data.recent:data.trending;
  const items=await mediaViews(userId,{ids,limit:60});
  const byId=new Map(items.map(i=>[i.id,i]));
  return {items:ids.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]),failure:data.providerUnavailable?'Some discovery providers are unavailable. Please try again.':''};
}
async function gameDiscovery(userId:string,section:DiscoverySection):Promise<DiscoveryContent>{
  const [instance]=await getDb().select().from(providerInstances).where(and(eq(providerInstances.provider,'igdb'),eq(providerInstances.enabled,true),sql`${providerInstances.credentials} is not null`)).limit(1);
  if(!instance)return {items:[],failure:'',notice:'Connect IGDB in Integrations to discover games.'};
  try{
    const remote=await discoverIgdb(instance.id,section);
    const ids=remote.map(g=>g.externalId);
    const local=ids.length?await getDb().select({game:games,available:ownedGameAvailable(userId),externalId:gameExternalIds.externalId}).from(games).innerJoin(gameExternalIds,and(eq(gameExternalIds.gameId,games.id),eq(gameExternalIds.provider,'igdb'))).where(sql`${gameExternalIds.externalId} in (${sql.join(ids.map(id=>sql`${id}`),sql`,`)})`):[];
    const byId=new Map(local.map(g=>[g.externalId,g]));
    return {items:remote.map(g=>{const saved=byId.get(g.externalId);return saved?gameCard({...saved.game,available:saved.available}):gameCard({...g,id:`igdb:${g.externalId}`},`/games/igdb/${instance.id}/${g.externalId}`);}),failure:'',notice:section==='trending'?'Trending by IGDB popularity.':undefined};
  }catch(cause){if(cause instanceof AppError&&cause.status===404)throw cause;return {items:[],failure:'Game discovery could not be loaded. Please try again.'};}
}
async function musicDiscovery(userId:string,section:DiscoverySection):Promise<DiscoveryContent>{
  // Popularity uses visible activity only; a shared catalogue never grants access.
  const rows=await getDb().execute<{id:string}>(sql`
    with accessible as materialized (
      select distinct m.id,m.kind,m.release_date from music_works m
      where exists(select 1 from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id
        where a.media_id=m.id and a.user_id=${userId} and a.state='available' and c.user_id=${userId} and c.status='connected' and i.enabled and i.provider='jellyfin')
        and (m.kind='album' or not exists(select 1 from media_relationships r join music_works p on p.id=r.parent_id where r.child_id=m.id and r.kind='contains' and p.kind='album'))
    ), listens as (
      select l.track_id,count(*)::int as plays from music_listens l
      where l.occurred_at_known and l.occurred_at>=now()-interval '30 days' and social_visible(l.user_id,${userId}::uuid,'activity','music') group by l.track_id
    ), popularity as (
      select a.id,a.release_date,coalesce((select sum(l.plays) from listens l where l.track_id=a.id or exists(select 1 from media_relationships r where r.parent_id=a.id and r.child_id=l.track_id and r.kind='contains')),0) as plays from accessible a
    ) select id from popularity where ${section==='recent'?sql`release_date is not null and release_date<=current_date`:sql`plays>0`}
    order by ${section==='recent'?sql`release_date desc`:sql`plays desc`},id limit 60`);
  const items=await workCards(userId,userId,rows.map(r=>r.id));
  return {items:items.map(item=>({...item,available:true})),failure:'',notice:section==='trending'?'Popular over the last 30 days in your accessible music, using listening activity shared with you.':'Releases in your accessible music libraries.'};
}
export function discoveryParameters(url:URL):{surface:DiscoverySurface;section:DiscoverySection}{
  return v.parse(v.object({surface:v.optional(v.picklist(['watch','play','listen']),'watch'),section:v.optional(v.picklist(['trending','recent']),'trending')}),Object.fromEntries(['surface','section'].flatMap(k=>url.searchParams.has(k)?[[k,url.searchParams.get(k)]]:[])));
}
