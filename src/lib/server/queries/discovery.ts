import { and, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { games, gameExternalIds, providerInstances } from '$lib/server/db/schema';
import { getConfig } from '$lib/server/config';
import { requireExperimentalFeature } from '$lib/server/experimental';
import { AppError } from '$lib/server/security/errors';
import { discoverIgdb } from '$lib/providers/igdb/service.server';
import { gameCard } from '$lib/games/presentation';
import { ownedGameAvailable } from '$lib/games/availability.server';
import { workCards } from '$lib/collection/query.server';
import { discoverMedia } from '$lib/catalogue/service.server';
import { mediaViews } from './media';
import type { DiscoveryContent, DiscoverySection, DiscoverySurface } from '$lib/discovery';
import { readingProviderCards } from '$lib/reading/query.server';
import { discoverReading, readingProviderConfigured } from '$lib/providers/reading.server';
import { READING_PROVIDER_PAGE_LIMIT } from '$lib/reading/model';
import { requireEnabledCategory } from '$lib/server/experimental';
import { ProviderHttpError } from '$lib/server/security/provider-fetch';
import { providerApiError } from '$lib/server/security/provider-api-error';
import { surfaceEnabled } from '$lib/experimental';
import { pageNumberSchema } from './pagination';
export async function discoveryContent(userId:string,raw:unknown):Promise<DiscoveryContent>{
  const input=v.parse(v.object({surface:v.picklist(['watch','play','listen','read']),section:v.picklist(['trending','recent']),kind:v.optional(v.picklist(['all','book','comic']),'all'),page:v.optional(pageNumberSchema,1)}),raw);
  if(input.surface==='read'){
    const config = await getConfig();
    if (!surfaceEnabled(config, 'read')) throw new AppError(404, 'Reading is disabled.', 'experimental_disabled');
    if (input.kind !== 'all') requireEnabledCategory(config, input.kind);
    v.parse(v.pipe(pageNumberSchema, v.maxValue(READING_PROVIDER_PAGE_LIMIT)), input.page);
    const kinds = (['book', 'comic'] as const).filter(kind => (input.kind === 'all' || kind === input.kind) && (kind === 'book' ? config.experimentalBooks : config.experimentalComics));
    const results = await Promise.all(kinds.map(async kind => {
      const empty = { items: [], total: 0, pages: 1, failure: '', notice: '' };
      if (kind === 'comic' && input.section === 'trending') return { ...empty, notice: 'Comic Vine does not provide a trending feed. Browse Recently released for new comics.' };
      try {
        if (!await readingProviderConfigured(kind)) return { ...empty, notice: 'Connect Comic Vine in Integrations to discover comics.' };
        const result = await discoverReading(kind, input.section, input.page);
        return { ...result, pages: Math.max(input.page, Math.min(READING_PROVIDER_PAGE_LIMIT, Math.ceil(result.total / (kind === 'book' ? 20 : 10)))), failure: '', notice: kind === 'book' ? input.section === 'trending' ? 'Trending on Open Library.' : 'Books ordered by first publication year on Open Library.' : 'Comic releases from Comic Vine, ordered by store date.' };
      } catch (cause) {
        return { ...empty, failure: cause instanceof AppError ? cause.message : cause instanceof ProviderHttpError ? providerApiError(cause).body.error : 'Reading discovery could not be loaded. Please try again.' };
      }
    }));
    return {
      items: await readingProviderCards(userId, results.flatMap(result => result.items).filter(item => kinds.includes(item.kind))),
      total: results.reduce((total, result) => total + result.total, 0),
      page: input.page, pages: Math.max(input.page, ...results.map(result => result.pages)),
      failure: results.map(result => result.failure).filter(Boolean).join(' '),
      notice: results.map(result => result.notice).filter(Boolean).join(' '),
    };
  }
  if(input.surface!=='watch')requireExperimentalFeature(await getConfig(), input.surface === 'listen' ? 'music' : 'gaming');
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
export function discoveryParameters(url:URL):{surface:DiscoverySurface;section:DiscoverySection;kind:'all'|'book'|'comic';page:number}{
  return v.parse(v.object({surface:v.optional(v.picklist(['watch','play','listen','read']),'watch'),section:v.optional(v.picklist(['trending','recent']),'trending'),kind:v.optional(v.picklist(['all','book','comic']),'all'),page:v.optional(pageNumberSchema,1)}),{...Object.fromEntries(['surface','section','kind'].flatMap(k=>url.searchParams.has(k)?[[k,url.searchParams.get(k)]]:[])),...(url.searchParams.has('page')?{page:Number(url.searchParams.get('page'))}:{})});
}
