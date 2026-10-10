import {eq,sql} from 'drizzle-orm';
import * as v from 'valibot';
import {providerConnections,providerInstances,recommendationSets,users} from '$lib/server/db/schema';
import {assertJobLease,jobCheckpoint,readJobCheckpoint,saveJobCheckpoint} from '$lib/server/queue/execution';
import {getDb,getSql} from '$lib/server/db/index';
import type {Metadata} from '$lib/providers/contracts';
import {getConfig} from '$lib/server/config';
import {ProviderHttpError} from '$lib/server/security/provider-fetch';
import {getTmdb,ingestMetadata} from '$lib/catalogue/service.server';
import {getTrakt} from '$lib/providers/trakt/connection.server';
import {igdbRecommendations} from '$lib/providers/igdb/service.server';
import {importIgdbMetadata} from '$lib/core/games/service.server';
import {providerSchedule} from '$lib/providers/schedule';
import {serviceTasks} from '$lib/providers/tasks';
import {taskDue,taskSchedulingEnabled} from '$lib/providers/task-timing';
import {promotedPurpose,readJobPurpose} from '$lib/providers/job-policy';
import {PermanentActionError,type OutboxAction} from '$lib/server/queue/index';
import {interestWorks} from './interests.server';
type Tx=Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type RecommendationAccount={id:string;user_id:string|undefined;account_generation:string|null;external_user_id:string|null;settings:Record<string,unknown>;completed:Date|null};
type Options={instanceId?:string;adminId?:string;kind?:string;task?:string;force?:boolean};
/** Existing maintenance transaction/queue owns deduplication, pauses, service pacing and retries. */
export async function scheduleRecommendationRefresh(tx:Tx,options:Options){
 const config=await getConfig();
 if(options.task&&!['all','metadata','tracking'].includes(options.task))return {queued:0,active:0};
 const instances=await tx.execute<{id:string;provider:string;settings:Record<string,unknown>}>(sql`select id,provider,settings from provider_instances where enabled and credentials is not null and provider in ('tmdb','igdb','trakt') and (${options.instanceId??null}::uuid is null or id=${options.instanceId??null}::uuid) order by id`);
 let queued=0,active=0;
 const now=Date.now();
 for(const instance of instances){
  const kind=`${instance.provider}.recommendations`,schedule=providerSchedule(instance.provider,instance.settings.schedule);
  const task=serviceTasks(instance.provider).find(entry=>entry.kinds[0]===kind)!;
  if(options.kind&&options.kind!==kind||!taskSchedulingEnabled(instance.provider,true,task,schedule,config,options.force))continue;
  if(options.task==='tracking'&&instance.provider!=='trakt'||options.task==='metadata'&&instance.provider==='trakt')continue;
  const busy=await tx.execute<{id:string;connection_id:string|null;payload:Record<string,unknown>}>(sql`select a.id,a.connection_id,a.payload from outbox_actions a
   left join provider_connections c on c.id=a.connection_id where a.kind=${kind}
   and coalesce(a.payload->>'instanceId',c.instance_id::text)=${instance.id}
   and a.state in ('pending','running','failed') and (a.account_generation is null or a.account_generation=c.account_generation)`);
  async function promote(job:(typeof busy)[number]){
   if(!options.force)return;
   const purpose=promotedPurpose(readJobPurpose(job.payload,'scheduled'),'manual');
   await tx.execute(sql`update outbox_actions set payload=payload||${{_manual:true,_jobPurpose:purpose}}::jsonb where id=${job.id} and state in ('pending','running')`);
  }
  if(instance.provider!=='trakt'&&busy.length){await promote(busy[0]);active++;continue;}
  const accounts:RecommendationAccount[]=instance.provider==='trakt'?Array.from(await tx.execute<RecommendationAccount>(sql`
   select c.id,c.user_id,c.account_generation,c.external_user_id,c.settings,
    (select max(a.updated_at) from outbox_actions a where a.connection_id=c.id and a.kind=${kind} and a.state='succeeded' and (a.account_generation is null or a.account_generation=c.account_generation)) as completed
   from provider_connections c join users u on u.id=c.user_id and not u.disabled
   where c.instance_id=${instance.id} and c.status='connected' and c.credentials is not null order by c.created_at,c.id`)) as RecommendationAccount[]:[];
  const [last]=instance.provider==='trakt'?[]:await tx.execute<{updated:Date|null}>(sql`select max(updated_at) as updated from outbox_actions where kind=${kind} and payload->>'instanceId'=${instance.id} and state='succeeded'`);
  const [admin]=instance.provider==='trakt'?[]:await tx.execute<{id:string}>(sql`select id from users where role='admin' and not disabled order by created_at,id limit 1`);
  const candidates:RecommendationAccount[]=instance.provider==='trakt'?accounts:[{id:instance.id,user_id:admin?.id,account_generation:null,external_user_id:null,settings:{},completed:last?.updated??null}];
  const due:RecommendationAccount[]=[];
  for(const account of candidates){
   const job=busy.find(entry=>entry.connection_id===account.id);
   if(job){await promote(job);active++;continue;}
   const timing=taskDue(task,schedule,instance.settings,{...account,externalUserId:account.external_user_id,role:'user'}, {completed:account.completed},now,options.force);
   if(account.user_id&&timing.at!=null&&timing.at<=now)due.push(account);
  }
  due.sort((a,b)=>new Date(a.completed??0).getTime()-new Date(b.completed??0).getTime());
  for(const account of options.force?due:due.slice(0,1)){
   const personal=instance.provider==='trakt';
   await tx.execute(sql`insert into outbox_actions(user_id,connection_id,account_generation,kind,payload,compaction_key)
    values(${account.user_id!},${personal?account.id:null},${account.account_generation},${kind},${{instanceId:instance.id,force:!!options.force,_manual:!!options.force,_jobPurpose:options.force?'manual':'scheduled'}}::jsonb,${kind})`);queued++;
  }
 }
 return {queued,active};
}
const checkpointSchema=v.object({
 task:v.literal('provider-recommendations'),instanceId:v.string(),
 seeds:v.pipe(v.array(v.object({id:v.nullable(v.string()),external_id:v.string(),kind:v.picklist(['movie','show','game'])})),v.maxLength(6)),
 next:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(6)),
 added:v.pipe(v.number(),v.integer(),v.minValue(0)),
});
async function saveSet(instanceId:string,key:string,ids:string[],seedId:string|null,action:OutboxAction){
 await getDb().transaction(async tx=>{
  if(action.connectionId){
   const [account]=await tx.select().from(providerConnections).where(eq(providerConnections.id,action.connectionId)).for('update');
   if(!account||account.userId!==action.userId||account.instanceId!==instanceId||account.status!=='connected'||account.accountGeneration!==action.accountGeneration)
    throw new PermanentActionError('The recommendation account changed.');
  }
  const [instance]=await tx.select().from(providerInstances).where(eq(providerInstances.id,instanceId)).for('update');
  const [user]=await tx.select().from(users).where(eq(users.id,action.userId)).for('update');
  if(!instance?.enabled||!instance.credentials||!user||user.disabled)throw new PermanentActionError('The recommendation service is unavailable.');
  await assertJobLease(tx,true);
  const items=[...new Set(ids)].slice(0,60);
  await tx.insert(recommendationSets).values({instanceId,key,seedId,connectionId:action.connectionId,accountGeneration:action.accountGeneration??null,items})
   .onConflictDoUpdate({target:[recommendationSets.instanceId,recommendationSets.key],set:{seedId,connectionId:action.connectionId,accountGeneration:action.accountGeneration??null,items,updatedAt:new Date()}});
 });
}
export async function refreshProviderRecommendations(action:OutboxAction){
 const config=await getConfig();
 const db=getSql();const [instance]=await db`select * from provider_instances where id=${String(action.payload.instanceId)} and enabled and credentials is not null`;
 if(!instance||action.kind!==`${instance.provider}.recommendations`)throw new PermanentActionError('The recommendation service is unavailable.');
 if(instance.provider==='igdb'&&!config.experimentalGaming)throw new PermanentActionError('Gaming is disabled.');
 if(instance.provider==='trakt'&&(!action.connectionId||!config.enableTrakt))throw new PermanentActionError('The connected account is unavailable.');
 const parsed=v.safeParse(checkpointSchema,await readJobCheckpoint());
 let checkpoint=parsed.success&&parsed.output.instanceId===instance.id?parsed.output:null;
 if(!checkpoint){
  let seeds:v.InferOutput<typeof checkpointSchema>['seeds'];
  if(instance.provider==='trakt')seeds=[{id:null,external_id:'',kind:'movie'},{id:null,external_id:'',kind:'show'}];
  else{
   const interests=(await interestWorks(null)).filter(work=>work.weight>0&&work.category===(instance.provider==='igdb'?'game':'screen'));
   const workIds=interests.sort((a,b)=>b.weight-a.weight||new Date(b.updated).getTime()-new Date(a.updated).getTime()).map(work=>work.id);
   seeds=workIds.length?Array.from(await db<{id:string;external_id:string;kind:'movie'|'show'|'game'}[]>`select w.id,w.kind,coalesce(e.external_id,g.external_id) as external_id from works w left join external_ids e on e.media_id=w.id and e.provider='tmdb' and e.media_kind=w.kind left join game_external_ids g on g.game_id=w.id and g.provider='igdb' left join recommendation_sets r on r.instance_id=${instance.id} and r.seed_id=w.id where w.id=any(${db.array(workIds,'UUID')}::uuid[]) and coalesce(e.external_id,g.external_id) is not null and (${!!action.payload.force} or r.updated_at is null or r.updated_at<now()-interval '1 day') order by r.updated_at nulls first,array_position(${db.array(workIds,'UUID')},w.id),w.id limit 6`):[];
  }
  checkpoint={task:'provider-recommendations',instanceId:instance.id,seeds,next:0,added:0};
  // Freeze the bounded selection before any set's freshness changes. A resumed
  // forced run must not select the same first seeds or a different batch.
  await saveJobCheckpoint(checkpoint);
 }
 if(checkpoint.next>=checkpoint.seeds.length)return {checked:checkpoint.next,added:checkpoint.added};
 const trakt=instance.provider==='trakt'?(await getTrakt(action.userId,action.connectionId!)).adapter:null;
 const tmdb=instance.provider==='tmdb'?await getTmdb('en-US','GB',instance.id):null;
 for(;checkpoint.next<checkpoint.seeds.length;){
  const seed=checkpoint.seeds[checkpoint.next],ids:string[]=[];
  if(trakt&&seed.kind!=='game'){
   for(const item of (await trakt.recommendations(seed.kind)).slice(0,40)){
    if(!item.ids.tmdb)continue;
    const saved=await ingestMetadata({provider:'tmdb',externalId:String(item.ids.tmdb),kind:seed.kind,title:item.title,externalIds:{trakt:String(item.ids.trakt),...(item.ids.imdb?{imdb:item.ids.imdb}:{})}});ids.push(saved.id);
   }
  }else if(tmdb&&seed.kind!=='game'){
   let suggestions:Metadata[];
   try{suggestions=await tmdb.recommendations(seed.kind,seed.external_id);}catch(error){if(!(error instanceof ProviderHttpError)||error.status!==404)throw error;suggestions=[];}
   for(const item of suggestions.slice(0,20))ids.push((await ingestMetadata(item)).id);
  }else if(instance.provider==='igdb')for(const item of await igdbRecommendations(instance.id,seed.external_id))ids.push((await importIgdbMetadata(item)).id);
  await saveSet(instance.id,trakt?`account:${action.connectionId}:${seed.kind}`:`seed:${seed.id}`,ids.filter(id=>id!==seed.id),seed.id,action);
  checkpoint.next++;checkpoint.added+=ids.length;
  await saveJobCheckpoint(checkpoint);
  await jobCheckpoint();
 }
 return {checked:checkpoint.next,added:checkpoint.added};
}
