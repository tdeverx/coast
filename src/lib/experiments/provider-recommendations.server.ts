import {sql} from 'drizzle-orm';
import {getDb,getSql} from '$lib/server/db';
import type {Metadata} from '$lib/providers/contracts';
import {getConfig} from '$lib/server/config';
import {ProviderHttpError} from '$lib/server/security/provider-fetch';
import {getTmdb,ingestMetadata} from '$lib/catalogue/service';
import {getTrakt} from '$lib/providers/trakt/connection.server';
import {igdbRecommendations} from '$lib/providers/igdb/service.server';
import {importIgdbMetadata} from '$lib/core/games/service';
import {providerSchedule} from '$lib/providers/schedule';
import {PermanentActionError,type OutboxAction} from '$lib/server/queue';
import {interestWorks} from './interests.server';
type Tx=Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type Options={instanceId?:string;adminId?:string;kind?:string;task?:string;force?:boolean};
/** Existing maintenance transaction/queue owns deduplication, pauses, service pacing and retries. */
export async function scheduleRecommendationRefresh(tx:Tx,options:Options){
 const config=await getConfig();
 if(options.task&&!['all','metadata','tracking'].includes(options.task))return {queued:0,active:0};
 const instances=await tx.execute<{id:string;provider:string;settings:Record<string,unknown>}>(sql`select id,provider,settings from provider_instances where enabled and credentials is not null and provider in ('tmdb','igdb','trakt') and (${options.instanceId??null}::uuid is null or id=${options.instanceId??null}::uuid) order by id`);
 let queued=0,active=0;
 for(const instance of instances){
  const kind=`${instance.provider}.recommendations`,schedule=providerSchedule(instance.provider,instance.settings.schedule);
  if(options.kind&&options.kind!==kind||!options.force&&(!schedule.enabled||!schedule.recommendationsEnabled)||instance.provider==='igdb'&&!config.experimentalGaming||instance.provider==='trakt'&&!config.enableTrakt)continue;
  if(options.task==='tracking'&&instance.provider!=='trakt'||options.task==='metadata'&&instance.provider==='trakt')continue;
  const [busy]=await tx.execute(sql`select id from outbox_actions where kind=${kind} and coalesce(payload->>'instanceId',(select instance_id::text from provider_connections where id=connection_id))=${instance.id} and (state in ('pending','running') or state='failed' and connection_id is null) limit 1`);
  if(busy){if(options.force)await tx.execute(sql`update outbox_actions set payload=payload||'{"_manual":true}'::jsonb where id=${busy.id} and state='pending'`);active++;continue;}
  const [last]=await tx.execute<{updated:Date|null}>(sql`select max(updated_at) as updated from outbox_actions where kind=${kind} and payload->>'instanceId'=${instance.id} and state='succeeded'`);
  if(instance.provider!=='trakt'&&!options.force&&last?.updated&&Date.now()-new Date(last.updated).getTime()<schedule.recommendationsIntervalMinutes*60000)continue;
  const accounts=instance.provider==='trakt'?await tx.execute<{id:string;user_id:string;account_generation:string}>(sql`select c.id,c.user_id,c.account_generation from provider_connections c join users u on u.id=c.user_id and not u.disabled where c.instance_id=${instance.id} and c.status='connected' and c.credentials is not null and not exists(select 1 from outbox_actions a where a.connection_id=c.id and a.kind=${kind} and a.state in ('pending','running','failed')) and not exists(select 1 from outbox_actions a where a.connection_id=c.id and a.kind=${kind} and a.state='succeeded' and a.account_generation=c.account_generation and a.updated_at>now()-make_interval(mins=>${schedule.recommendationsIntervalMinutes})) order by c.created_at,c.id limit 1`):[];
  const [admin]=await tx.execute<{id:string}>(sql`select id from users where role='admin' and not disabled order by created_at,id limit 1`);
  const account=accounts[0],user=account?.user_id??admin?.id;if(!user||instance.provider==='trakt'&&!account)continue;
  await tx.execute(sql`insert into outbox_actions(user_id,connection_id,account_generation,kind,payload,compaction_key) values(${user},${account?.id??null},${account?.account_generation??null},${kind},${{instanceId:instance.id,force:!!options.force,_manual:!!options.force}}::jsonb,${kind})`);queued++;
 }
 return {queued,active};
}
async function saveSet(instanceId:string,key:string,ids:string[],seedId:string|null,action:OutboxAction){
 const db=getSql();
 await db`insert into recommendation_sets(instance_id,key,seed_id,connection_id,account_generation,items)
 select ${instanceId},${key},${seedId},${action.connectionId},${action.accountGeneration??null},${db.array([...new Set(ids)].slice(0,60),'UUID')}::uuid[]
 where ${action.connectionId}::uuid is null or exists(select 1 from provider_connections where id=${action.connectionId} and status='connected' and account_generation=${action.accountGeneration??null}::uuid)
 on conflict(instance_id,key) do update set seed_id=excluded.seed_id,connection_id=excluded.connection_id,account_generation=excluded.account_generation,items=excluded.items,updated_at=now()`;
}
export async function refreshProviderRecommendations(action:OutboxAction){
 const config=await getConfig();
 const db=getSql();const [instance]=await db`select * from provider_instances where id=${String(action.payload.instanceId)} and enabled and credentials is not null`;
 if(!instance||action.kind!==`${instance.provider}.recommendations`)throw new PermanentActionError('The recommendation service is unavailable.');
 if(instance.provider==='igdb'&&!config.experimentalGaming)throw new PermanentActionError('Gaming is disabled.');
 let checked=0,added=0;
 if(instance.provider==='trakt'){
  if(!action.connectionId||!config.enableTrakt)throw new PermanentActionError('The connected account is unavailable.');
  const {adapter}=await getTrakt(action.userId,action.connectionId);
  for(const kind of ['movie','show'] as const){
   const items=await adapter.recommendations(kind),ids:string[]=[];
   for(const item of items.slice(0,40)){if(!item.ids.tmdb)continue;const saved=await ingestMetadata({provider:'tmdb',externalId:String(item.ids.tmdb),kind,title:item.title,externalIds:{trakt:String(item.ids.trakt),...(item.ids.imdb?{imdb:item.ids.imdb}:{})}});ids.push(saved.id);}
   await saveSet(instance.id,`account:${action.connectionId}:${kind}`,ids,null,action);checked++;added+=ids.length;
  }
 }else{
  const interests=(await interestWorks(null)).filter(work=>work.weight>0&&work.category===(instance.provider==='igdb'?'game':'screen'));
  const workIds=interests.sort((a,b)=>b.weight-a.weight||new Date(b.updated).getTime()-new Date(a.updated).getTime()).map(work=>work.id);if(!workIds.length)return {checked,added};
  const seeds=await db<{id:string;external_id:string;kind:'movie'|'show'|'game'}[]>`select w.id,w.kind,coalesce(e.external_id,g.external_id) as external_id from works w left join external_ids e on e.media_id=w.id and e.provider='tmdb' and e.media_kind=w.kind left join game_external_ids g on g.game_id=w.id and g.provider='igdb' left join recommendation_sets r on r.instance_id=${instance.id} and r.seed_id=w.id where w.id=any(${db.array(workIds,'UUID')}::uuid[]) and coalesce(e.external_id,g.external_id) is not null and (${!!action.payload.force} or r.updated_at is null or r.updated_at<now()-interval '1 day') order by r.updated_at nulls first,array_position(${db.array(workIds,'UUID')},w.id),w.id limit 6`;
  const tmdb=instance.provider==='tmdb'?await getTmdb('en-US','GB',instance.id):null;
  for(const seed of seeds){
   const ids:string[]=[];
   if(instance.provider==='tmdb'&&tmdb&&seed.kind!=='game'){
    let suggestions:Metadata[];
    try{suggestions=await tmdb.recommendations(seed.kind,seed.external_id);}catch(error){if(!(error instanceof ProviderHttpError)||error.status!==404)throw error;suggestions=[];}
    for(const item of suggestions.slice(0,20))ids.push((await ingestMetadata(item)).id);
   }
   else if(instance.provider==='igdb')for(const item of await igdbRecommendations(instance.id,seed.external_id))ids.push((await importIgdbMetadata(item)).id);
   await saveSet(instance.id,`seed:${seed.id}`,ids.filter(id=>id!==seed.id),seed.id,action);checked++;added+=ids.length;
  }
 }
 return {checked,added};
}
