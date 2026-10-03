import { and,eq,sql,inArray } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { providerConnections, collectionProjectionEntries as ledger, collectionProjectionPreviews as previews, media, episodes } from '$lib/server/db/schema';
import { getTrakt } from '$lib/providers/trakt/connection.server';
import { resolveTrakt } from '$lib/catalogue/trakt-identity.server';
import { exportIdentity } from '$lib/sync/trakt-identity';
import { ingestMetadata } from '$lib/catalogue/service';
import { PermanentActionError } from '$lib/server/queue';
import { enqueueInTransaction } from '$lib/sync/changes';
import { collectionCTE, collectionRead } from './query.server';
import { notify } from '$lib/server/notifications';
import type { TraktAdapter } from '$lib/providers/trakt/adapter.server';

export const projectionSchema=v.object({enabled:v.optional(v.boolean(),false),source:v.optional(v.picklist(['collected','personal','server']),'collected'),availableOnly:v.optional(v.boolean(),false),scope:v.optional(v.picklist(['dynamic','fixed']),'dynamic'),sourceIds:v.optional(v.pipe(v.array(v.pipe(v.string(),v.uuid())),v.maxLength(100)),[])});
export type ProjectionConfig=v.InferOutput<typeof projectionSchema>;
type Entry={workId:string;title:string;payload:Record<string,unknown>;snapshot:Record<string,unknown>};
export type ProjectionPreview={id:string;version:string;configuration:ProjectionConfig;additions:Entry[];removals:Entry[];uncertain:Entry[];conflicts:Entry[];unresolved:string[];blocked:boolean};
export function projectionConfig(settings:Record<string,unknown>){return v.parse(projectionSchema,settings.collectionProjection??{});}
function canonical(value:unknown):unknown{
  if(Array.isArray(value)){const items=value.map(canonical);return items.every(item=>item&&typeof item==='object'&&'workId' in item)?items.sort((a,b)=>String((a as Entry).workId).localeCompare(String((b as Entry).workId))):items;}
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export type ProjectionContext={connection:typeof providerConnections.$inferSelect;adapter:TraktAdapter};
async function verifiedContext(userId:string,connectionId:string,provided?:ProjectionContext){
  const context=provided??await getTrakt(userId,connectionId);
  const [current]=await getDb().select().from(providerConnections).where(and(eq(providerConnections.id,connectionId),eq(providerConnections.userId,userId),eq(providerConnections.status,'connected')));
  if(!current||current.accountGeneration!==context.connection.accountGeneration||current.syncAccountId!==context.connection.syncAccountId)throw new PermanentActionError('The connected account changed.');
  const profile=await context.adapter.profile();
  if(profile.id!==context.connection.externalUserId||!context.connection.syncAccountId)throw new PermanentActionError('Reconnect Trakt to verify the current account.');
  return context;
}
/** Fully read remote membership; episode payloads address exact numbers within a show. */
export async function readProjectionRemote(adapter:TraktAdapter):Promise<Map<string,Entry>>{
  const result=new Map<string,Entry>();
  for(let page=1;page<=10000;page++){
    const items=await adapter.read('collection',page);
    for(const record of items){const work=await resolveTrakt(record);if(!work||!record.movie)continue;result.set(work.id,{workId:work.id,title:work.title,payload:{movies:[{ids:record.movie.ids}]},snapshot:{collectedAt:record.collected_at??null,metadata:record.metadata??null}});}
    if(items.length<100)break;if(page===10000)throw new Error('Trakt collection exceeds the page bound.');
  }
  for(const record of await adapter.collectionShows()){
    if(!record.show)continue;const show=await resolveTrakt(record);if(!show)continue;
    for(const season of record.seasons??[])for(const episode of season.episodes){
      const [known]=await getDb().select({id:episodes.mediaId,title:media.title}).from(episodes).innerJoin(media,eq(media.id,episodes.mediaId)).where(and(eq(episodes.showId,show.id),eq(episodes.seasonNumber,season.number),eq(episodes.episodeNumber,episode.number)));
      const work=known??await ingestMetadata({provider:'trakt',externalId:`${record.show.ids.trakt}:episode:${season.number}:${episode.number}`,kind:'episode',title:`Episode ${episode.number}`,seasonNumber:season.number,episodeNumber:episode.number},{showId:show.id});
      result.set(work.id,{workId:work.id,title:`${show.title} · ${season.number}×${episode.number}`,payload:{shows:[{ids:record.show.ids,seasons:[{number:season.number,episodes:[{number:episode.number}]}]}]},snapshot:{collectedAt:episode.collected_at??record.collected_at??null,metadata:episode.metadata??null}});
    }
  }
  return result;
}
export async function desiredProjection(userId:string,configuration:ProjectionConfig,excludedSourceIds:string[]=[]){
  if(!configuration.enabled)return {entries:new Map<string,Entry>(),unresolved:[] as string[],blocked:false};
  const db=getDb();
  const selected=configuration.scope==='dynamic'?sql`true`:configuration.sourceIds.length?sql`c.id in (${sql.join(configuration.sourceIds.map(id=>sql`${id}::uuid`),sql`,`)})`:sql`false`;
  const omitted=excludedSourceIds.length?sql`c.id in (${sql.join(excludedSourceIds.map(id=>sql`${id}::uuid`),sql`,`)})`:sql`false`;
  const excluded=sql`(${omitted} or c.settings->>'collectionSourceExcluded'='true')`;
  const freshness=await db.execute(sql`select count(*) filter(where not coalesce(${excluded},false))::int as total,count(*) filter(where coalesce(${excluded},false))::int as excluded,count(*) filter(where not coalesce(${excluded},false) and (c.status<>'connected' or not i.enabled or p.scan_id is not null or p.completed_at is null or p.completed_at<now()-coalesce((i.settings->'schedule'->>'userIntervalMinutes')::int,10)*interval '2 minutes'))::int as uncertain
    from provider_connections c join provider_instances i on i.id=c.instance_id left join sync_checkpoints p on p.connection_id=c.id and p.kind='jellyfin-user'
    where c.user_id=${userId} and i.provider='jellyfin' and ${selected}`);
  const blocked=(configuration.source==='server'||configuration.availableOnly)&&((Number(freshness[0]?.total??0)===0&&Number(freshness[0]?.excluded??0)===0)||Number(freshness[0]?.uncertain??0)>0);
  const roots=configuration.source==='server'?sql`select distinct a.media_id as id from availability a join provider_connections c on c.id=a.connection_id join provider_instances i on i.id=c.instance_id where a.user_id=${userId} and a.state='available' and c.status='connected' and i.enabled and ${selected} and not coalesce(${excluded},false)`:
    sql`select c.id from collection c where exists(select 1 from jsonb_array_elements(c.reasons) r where r->>'origin' in ('direct','inherited') and (${configuration.source}='personal' or r->>'relationship'='collected'))`;
  const rows=await collectionRead(sql`${collectionCTE(userId,userId)}, roots as (${roots}) select distinct a.id,a.title,a.kind,a.release_date,e.show_id,e.season_number,e.episode_number
    from roots r join descendants d on d.root=r.id join assessments a on a.id=d.id left join episodes e on e.media_id=a.id
    where a.kind in ('movie','episode') and (a.id=r.id and (a.release_date is null or a.release_date::date<=current_date) or a.release_date::date<=current_date)
    and (${!configuration.availableOnly&&configuration.source!=='server'} or exists(select 1 from availability av join provider_connections c on c.id=av.connection_id join provider_instances i on i.id=c.instance_id where av.user_id=${userId} and av.media_id=a.id and av.state='available' and c.status='connected' and i.enabled and ${selected} and not coalesce(${excluded},false)))`);
  const entries=new Map<string,Entry>(),unresolved:string[]=[];
  for(const row of rows){
    const id=String(row.id),kind=row.kind as 'movie'|'episode';let payload:Record<string,unknown>;
    if(kind==='movie'){const ids=await exportIdentity(id,kind);if(!Object.keys(ids).length){unresolved.push(String(row.title));continue;}payload={movies:[{ids}]};}
    else {const ids=await exportIdentity(String(row.show_id),'show');if(!Object.keys(ids).length){unresolved.push(String(row.title));continue;}payload={shows:[{ids,seasons:[{number:row.season_number,episodes:[{number:row.episode_number}]}]}]};}
    entries.set(id,{workId:id,title:String(row.title),payload,snapshot:{}});
  }
  return {entries,unresolved,blocked};
}
export async function previewProjection(userId:string,connectionId:string,input:unknown,provided?:ProjectionContext):Promise<ProjectionPreview>{
  const configuration=v.parse(projectionSchema,input),context=await verifiedContext(userId,connectionId,provided);
  if(configuration.scope==='fixed'&&configuration.sourceIds.length){const sources=await getDb().execute(sql`select c.id from provider_connections c join provider_instances i on i.id=c.instance_id where c.user_id=${userId} and i.provider='jellyfin' and c.id in (${sql.join(configuration.sourceIds.map(id=>sql`${id}::uuid`),sql`,`)})`);if(sources.length!==configuration.sourceIds.length)throw new Error('Choose your own linked media sources.');}
  const remote=await readProjectionRemote(context.adapter),desired=await desiredProjection(userId,configuration),previous=await getDb().select().from(ledger).where(eq(ledger.accountId,context.connection.syncAccountId!));
  const additions=[...desired.entries.values()].filter(e=>!remote.has(e.workId));
  const removals=[...remote.values()].filter(e=>!desired.entries.has(e.workId));
  const uncertain=previous.filter(old=>!old.suppressed&&old.attribution==='uncertain').map(old=>remote.get(old.workId)??desired.entries.get(old.workId)??{workId:old.workId,title:'Unconfirmed entry',payload:{},snapshot:{}});
  const conflicts=previous.filter(old=>!old.suppressed&&old.attribution==='coast-added'&&(!remote.has(old.workId)||!same(old.remote,remote.get(old.workId)!.snapshot)))
    .map(old=>remote.get(old.workId)??desired.entries.get(old.workId)??{workId:old.workId,title:'Removed entry',payload:{},snapshot:{}});
  const version=String(context.connection.settings.collectionProjectionVersion??context.connection.accountGeneration);
  const [saved]=await getDb().insert(previews).values({connectionId,accountId:context.connection.syncAccountId!,configurationVersion:version,configuration,snapshot:{additions,removals,uncertain,conflicts,remote:[...remote.values()],unresolved:desired.unresolved,blocked:desired.blocked}}).returning();
  return {id:saved.id,version,configuration,additions,removals,uncertain,conflicts,unresolved:desired.unresolved,blocked:desired.blocked};
}
export async function approveProjection(userId:string,connectionId:string,input:unknown,provided?:ProjectionContext){
  const data=v.parse(v.object({previewId:v.pipe(v.string(),v.uuid()),choice:v.picklist(['leave','remove-managed','replace-all','clear-all'])}),input),context=await verifiedContext(userId,connectionId,provided);
  const [preview]=await getDb().select().from(previews).where(and(eq(previews.id,data.previewId),eq(previews.connectionId,connectionId),eq(previews.accountId,context.connection.syncAccountId!)));
  const version=String(context.connection.settings.collectionProjectionVersion??context.connection.accountGeneration);
  if(!preview||preview.approved||preview.configurationVersion!==version||Date.now()-preview.createdAt.getTime()>3600000)throw new Error('This preview has expired. Preview again.');
  const configuration=v.parse(projectionSchema,preview.configuration),nextVersion=crypto.randomUUID();
  if(data.choice==='clear-all'&&configuration.enabled)throw new Error('Clear all is only available when disabling export.');
  if(preview.snapshot.blocked&&data.choice!=='leave')throw new Error('Complete source assessments are required before removing entries.');
  const remote=await readProjectionRemote(context.adapter);
  if(!same([...remote.values()],preview.snapshot.remote))throw new Error('The remote Collection changed. Preview again.');
  await getDb().transaction(async tx=>{
    const [current]=await tx.select().from(providerConnections).where(eq(providerConnections.id,connectionId)).for('update');
    if(current.accountGeneration!==context.connection.accountGeneration||String(current.settings.collectionProjectionVersion??current.accountGeneration)!==version)throw new Error('The account or configuration changed. Preview again.');
    await tx.update(providerConnections).set({settings:{...current.settings,collectionProjection:configuration,collectionProjectionVersion:nextVersion}}).where(eq(providerConnections.id,connectionId));
    await tx.update(previews).set({approved:true}).where(eq(previews.id,preview.id));
    await enqueueInTransaction(tx,{userId,connectionId,kind:'trakt.collection-cleanup',payload:{previewId:preview.id,version:nextVersion,choice:data.choice},compactionKey:`collection-cleanup:${preview.id}`});
  });
  // Approved cleanup retains its own configuration even when export has been disabled.
  return {configuration,version:nextVersion};
}
export async function executeProjection(userId:string,connectionId:string,cleanup?:Record<string,unknown>,provided?:ProjectionContext){
  const context=await verifiedContext(userId,connectionId,provided),accountId=context.connection.syncAccountId!,remote=await readProjectionRemote(context.adapter);
  const config=projectionConfig(context.connection.settings),desired=await desiredProjection(userId,config),previous=await getDb().select().from(ledger).where(eq(ledger.accountId,accountId));
  const old=new Map(previous.map(e=>[e.workId,e]));
  let approved:typeof previews.$inferSelect|undefined;
  if(cleanup){
    [approved]=await getDb().select().from(previews).where(and(eq(previews.id,String(cleanup.previewId)),eq(previews.connectionId,connectionId),eq(previews.accountId,accountId),eq(previews.approved,true)));
    if(!approved||context.connection.settings.collectionProjectionVersion!==cleanup.version)throw new PermanentActionError('The approved cleanup configuration changed.');
  }
  const removals=approved?(approved.snapshot.removals as Entry[]):[];
  const eligible:Entry[]=[];
  for(const entry of removals){
    const current=remote.get(entry.workId);if(!current)continue;
    const evidence=old.get(entry.workId),choice=cleanup?.choice;
    const permitted=choice==='replace-all'||choice==='clear-all'||choice==='remove-managed'&&evidence?.attribution==='coast-added'&&!evidence.conflict&&!evidence.suppressed&&same(evidence.remote,current.snapshot);
    if(!permitted)continue;
    if(desired.blocked||!same(current.snapshot,entry.snapshot)||config.enabled&&desired.entries.has(entry.workId))throw new PermanentActionError('Collection/source state changed. Preview removals again.');
    eligible.push(entry);
  }
  // Bound writes and confirmation traversals by batch, rather than by each leaf.
  for(let offset=0;offset<eligible.length;offset+=50){
    type ShowPayload={ids:Record<string,unknown>;seasons:{number:number;episodes:{number:number}[]}[]};
    const batch=eligible.slice(offset,offset+50),movies:unknown[]=[],shows=new Map<string,ShowPayload>();
    for(const entry of batch){
      const payload=entry.payload as {movies?:unknown[];shows?:ShowPayload[]};
      movies.push(...payload.movies??[]);
      for(const incoming of payload.shows??[]){
        const key=JSON.stringify(incoming.ids),show=shows.get(key)??{ids:incoming.ids,seasons:[]};
        for(const incomingSeason of incoming.seasons??[]){
          let season=show.seasons.find((value:{number:number})=>value.number===incomingSeason.number);
          if(!season){season={number:incomingSeason.number,episodes:[]};show.seasons.push(season);}
          season.episodes.push(...incomingSeason.episodes);
        }
        shows.set(key,show);
      }
    }
    await context.adapter.write('collection',{movies,shows:[...shows.values()]},true);
    const confirmed=await readProjectionRemote(context.adapter);
    if(batch.some(entry=>confirmed.has(entry.workId)))throw new Error('Trakt did not confirm Collection removal.');
    await getDb().update(ledger).set({desired:false}).where(and(eq(ledger.accountId,accountId),inArray(ledger.workId,batch.map(entry=>entry.workId))));
    for(const entry of batch)remote.delete(entry.workId);
  }
  if(!config.enabled)return;
  for(const entry of desired.entries.values()){
    const current=remote.get(entry.workId),evidence=old.get(entry.workId);
    if(evidence?.suppressed)continue;
    if(evidence?.attribution==='uncertain'){
      await notify({userId,kind:'sync',title:'Trakt Collection needs review',body:'Delivery attribution is uncertain. Review this entry in Collection export settings before managing it.',sourceKey:`projection-uncertain:${accountId}`});continue;
    }
    if(evidence?.attribution==='coast-added'&&(!current||!same(evidence.remote,current.snapshot))){
      await getDb().update(ledger).set({conflict:true}).where(and(eq(ledger.accountId,accountId),eq(ledger.workId,entry.workId)));
      await notify({userId,kind:'sync',title:'Trakt Collection changed remotely',body:'Review the changed entries in Collection export settings to choose the remote or Coast selection.',sourceKey:`projection-conflict:${accountId}`});continue;
    }
    if(current){if(!evidence)await getDb().insert(ledger).values({accountId,workId:entry.workId,attribution:'pre-existing',remote:current.snapshot});continue;}
    const collectedAt=new Date().toISOString();
    // Intent commits before delivery. A crash/lost response remains uncertain and cannot authorize cleanup.
    await getDb().insert(ledger).values({accountId,workId:entry.workId,attribution:'uncertain',remote:{collectedAt},desired:true}).onConflictDoUpdate({target:[ledger.accountId,ledger.workId],set:{attribution:'uncertain',remote:{collectedAt},desired:true,updatedAt:new Date()}});
    const payload=JSON.parse(JSON.stringify(entry.payload)) as Record<string,any>;
    for(const movie of payload.movies??[])movie.collected_at=collectedAt;
    for(const show of payload.shows??[])for(const season of show.seasons)for(const episode of season.episodes)episode.collected_at=collectedAt;
    await context.adapter.write('collection',payload);
    const confirmed=(await readProjectionRemote(context.adapter)).get(entry.workId);
    if(!confirmed)throw new Error('Trakt did not confirm Collection delivery.');
    const attributable=Date.parse(String(confirmed.snapshot.collectedAt))===Date.parse(collectedAt);
    await getDb().update(ledger).set({attribution:attributable?'coast-added':'uncertain',remote:confirmed.snapshot,updatedAt:new Date()}).where(and(eq(ledger.accountId,accountId),eq(ledger.workId,entry.workId)));
  }
  if(!approved && [...remote.values()].some(e=>old.get(e.workId)?.attribution==='coast-added'&&!desired.entries.has(e.workId))&&!desired.blocked)await notify({userId,kind:'sync',title:'Trakt Collection cleanup available',body:'Preview obsolete Coast-added entries in Settings before removing them.',sourceKey:`projection-review:${accountId}`});
}
export async function isGeneratedProjection(connectionId:string,workId:string){
  const [entry]=await getDb().select({attribution:ledger.attribution}).from(ledger).innerJoin(providerConnections,eq(providerConnections.syncAccountId,ledger.accountId)).where(and(eq(providerConnections.id,connectionId),eq(ledger.workId,workId)));
  return entry&&entry.attribution!=='pre-existing';
}

/** Review is queued with the same account generation as every other provider action. */
export async function reviewProjection(userId:string,connectionId:string,input:unknown,provided?:ProjectionContext){
  const data=v.parse(v.object({previewId:v.pipe(v.string(),v.uuid()),workId:v.pipe(v.string(),v.uuid()),choice:v.picklist(['remote','coast'])}),input);
  const context=await verifiedContext(userId,connectionId,provided);
  const [preview]=await getDb().select().from(previews).where(and(eq(previews.id,data.previewId),eq(previews.connectionId,connectionId),eq(previews.accountId,context.connection.syncAccountId!)));
  const version=String(context.connection.settings.collectionProjectionVersion??context.connection.accountGeneration);
  if(!preview||preview.configurationVersion!==version||Date.now()-preview.createdAt.getTime()>3600000)throw new Error('Preview again before reviewing this entry.');
  const candidates=[...(preview.snapshot.conflicts as Entry[]),...(preview.snapshot.uncertain as Entry[])];
  if(!candidates.some(e=>e.workId===data.workId))throw new Error('This entry does not need review.');
  const snapshot=(preview.snapshot.remote as Entry[]).find(e=>e.workId===data.workId)?.snapshot??null;
  await getDb().transaction(async tx=>{
    const [current]=await tx.select().from(providerConnections).where(eq(providerConnections.id,connectionId)).for('update');
    if(current.accountGeneration!==context.connection.accountGeneration||String(current.settings.collectionProjectionVersion??current.accountGeneration)!==version)throw new Error('The account or configuration changed. Preview again.');
    await enqueueInTransaction(tx,{userId,connectionId,kind:'trakt.collection-review',payload:{workId:data.workId,choice:data.choice,snapshot,version},compactionKey:`collection-review:${data.workId}`});
  });
  return {queued:true};
}
export async function executeProjectionReview(userId:string,connectionId:string,input:Record<string,unknown>,provided?:ProjectionContext){
  const data=v.parse(v.object({workId:v.pipe(v.string(),v.uuid()),choice:v.picklist(['remote','coast']),snapshot:v.nullable(v.record(v.string(),v.unknown())),version:v.string()}),input);
  const context=await verifiedContext(userId,connectionId,provided),accountId=context.connection.syncAccountId!;
  if(String(context.connection.settings.collectionProjectionVersion??context.connection.accountGeneration)!==data.version)throw new PermanentActionError('Collection settings changed. Review again.');
  const current=(await readProjectionRemote(context.adapter)).get(data.workId);
  if(!same(current?.snapshot??null,data.snapshot))throw new PermanentActionError('The remote entry changed. Review again.');
  if(data.choice==='remote')await getDb().update(ledger).set({suppressed:true,conflict:false,updatedAt:new Date()}).where(and(eq(ledger.accountId,accountId),eq(ledger.workId,data.workId)));
  else if(current)await getDb().update(ledger).set({attribution:'coast-added',remote:current.snapshot,suppressed:false,conflict:false,updatedAt:new Date()}).where(and(eq(ledger.accountId,accountId),eq(ledger.workId,data.workId)));
  else await getDb().delete(ledger).where(and(eq(ledger.accountId,accountId),eq(ledger.workId,data.workId)));
  await executeProjection(userId,connectionId,undefined,provided);
}
