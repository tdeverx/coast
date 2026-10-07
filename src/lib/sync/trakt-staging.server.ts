import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '$lib/server/db';
import { traktImportStages as stages, traktImportRecords as records, syncValues, syncListValues, providerConnections, lists } from '$lib/server/db/schema';
import { JobYield, jobCheckpoint, jobExecution } from '$lib/server/queue/execution';
import { PermanentActionError } from '$lib/server/queue';
import type { TraktAdapter, TraktRecord } from '$lib/providers/trakt/adapter.server';
import { compactTraktHistory } from './trakt-history';
import { reconcileProviderValue, type ValueCategory } from './values';
import { reconcileProviderList } from './list-values';
import { resolveTrakt } from '$lib/catalogue/trakt-identity.server';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Decision = 'agree'|'local'|'remote'|'conflict';
export type StageCommit = { stageId:string; ordinal:number; generation: string; commit: (tx: Tx, mediaId: string, decision: Decision) => Promise<void> };
type Category = 'history'|'progress'|'ratings'|'watchlist'|'collection'|'lists';

/** Stage and account effects share the worker lease and account generation. A
 * replaced worker rolls back its reconciliation instead of advancing a cursor. */
async function assertLease(tx: Tx, userId: string, connectionId: string) {
  const execution=jobExecution.getStore();
  if(!execution)throw new Error('A durable Trakt stage requires a queue execution.');
  const [row]=await tx.execute<{account_generation:string}>(sql`
    select c.account_generation from provider_connections c join outbox_actions a on a.connection_id=c.id
    join provider_instances i on i.id=c.instance_id join users u on u.id=c.user_id
    where a.id=${execution.id} and a.user_id=${userId} and c.id=${connectionId}
      and a.state='running' and a.attempts=${execution.attempts}
      and a.account_generation=c.account_generation and c.status='connected' and i.enabled and not u.disabled
    for update of c,a
  `);
  if(!row)throw new PermanentActionError('The Trakt account or import execution changed. Run the job for the current account.');
  return row.account_generation;
}

/** Durable raw observations remain private to one job/account. History is
 * fetched completely before its bounded oldest-first application starts. */
export async function stagedTraktCategory(options: {
  userId:string; connectionId:string; category:Category; adapter:TraktAdapter;
  stageKey?:string; readPage?:(page:number)=>Promise<TraktRecord[]>; skipCleanup?:boolean; retainRecords?:boolean;
  apply:(record:TraktRecord, commit:StageCommit)=>Promise<boolean|void>;
}) {
  const {userId,connectionId,category,adapter,apply}=options;
  const execution=jobExecution.getStore()!;
  const db=getDb();
  const key=options.stageKey??category;
  let [stage]=await db.select().from(stages).where(and(eq(stages.actionId,execution.id),eq(stages.category,key)));
  if(!stage){
    const activity=await adapter.lastActivity();
    stage=await db.transaction(async tx=>{
      const generation=await assertLease(tx,userId,connectionId);
      const [created]=await tx.insert(stages).values({actionId:execution.id,connectionId,accountGeneration:generation,category:key,activity}).returning();
      return created;
    });
  }
  const reload=async()=>{
    const [current]=await db.select().from(stages).where(eq(stages.id,stage.id));
    if(!current)throw new JobYield();
    stage=current;
  };
  async function restart(activity:string){
    const exhausted=stage.restarts>=3;
    await db.transaction(async tx=>{
      await assertLease(tx,userId,connectionId);
      await tx.delete(records).where(eq(records.stageId,stage.id));
      if(category==='lists')await tx.delete(stages).where(and(eq(stages.actionId,execution.id),sql`${stages.category} like 'list:%'`));
      await tx.update(stages).set({phase:'fetching',nextPage:1,activity,restarts:exhausted?0:stage.restarts+1,cleanedThrough:null,updatedAt:new Date()}).where(eq(stages.id,stage.id));
    });
    await reload();
    // Retain a fresh starting fence before backoff so a later stable retry can
    // converge instead of being permanently stuck at the restart bound.
    if(exhausted)throw new Error('Trakt changed repeatedly during the import. Retry when account activity has settled; incomplete coverage has not been published.');
    await jobCheckpoint();
  }
  for(;;){
    if(stage.phase==='done'){
      if(options.retainRecords){const activity=await adapter.lastActivity();if(activity!==stage.activity){await restart(activity);continue;}}
      return {stageId:stage.id,generation:stage.accountGeneration,imported:stage.imported,review:stage.review};
    }
    if(stage.phase==='fetching'){
      if(Math.abs(stage.nextPage)>10000)throw new Error('Trakt import exceeded the supported page bound.');
      // Collection movies and show episodes form one census. Negative page
      // numbers retain which endpoint comes next without a second cursor table.
      const shows=category==='collection'&&stage.nextPage<0;
      const remote=options.readPage?await options.readPage(stage.nextPage):shows?await adapter.collectionShowsPage(-stage.nextPage):await adapter.read(category as Exclude<Category,'lists'>,stage.nextPage);
      const limit=shows?10:100;
      if(remote.length>limit)throw new Error('Trakt returned an oversized import page; incomplete coverage has not been published.');
      const page:TraktRecord[]=shows?remote.flatMap(record=>(record.seasons??[]).flatMap(season=>season.episodes.map(episode=>({show:record.show,type:'coast-collection-episode',seasons:[{number:season.number,episodes:[episode]}]})))):remote;
      if(page.length>10000)throw new Error('Trakt returned too many collection episodes in one page; incomplete coverage has not been published.');
      const complete=remote.length<limit&&(category!=='collection'||shows);
      const nextPage=shows?stage.nextPage-1:category==='collection'&&remote.length<limit?-1:stage.nextPage+1;
      const titles=new Map();
      await db.transaction(async tx=>{
        await assertLease(tx,userId,connectionId);
        const [tail]=await tx.execute<{next:number}>(sql`select coalesce(max(ordinal)+1,0)::int as next from trakt_import_records where stage_id=${stage.id}`);
        for(let start=0;start<page.length;start+=1000)await tx.insert(records).values(page.slice(start,start+1000).map((record,index)=>({stageId:stage.id,ordinal:tail.next+start+index,sortKey:category==='history'?record.watched_at||'':'',record:category==='history'?compactTraktHistory(record,titles):record})));
        await tx.update(stages).set({nextPage,updatedAt:new Date()}).where(eq(stages.id,stage.id));
      });
      await reload();
      if(complete){
        const activity=await adapter.lastActivity();
        if(activity!==stage.activity){await restart(activity);continue;}
        await db.transaction(async tx=>{await assertLease(tx,userId,connectionId);await tx.update(stages).set({phase:'applying',updatedAt:new Date()}).where(eq(stages.id,stage.id));});
        await reload();
      }
      await jobCheckpoint();
      continue;
    }
    if(stage.phase==='applying'){
      const batch=await db.select().from(records).where(and(eq(records.stageId,stage.id),eq(records.applied,false))).orderBy(asc(records.sortKey),asc(records.ordinal)).limit(20);
      for(const record of batch){
        const committed=await apply(record.record,{stageId:stage.id,ordinal:record.ordinal,generation:stage.accountGeneration,commit:async(tx,mediaId,decision)=>{
          await assertLease(tx,userId,connectionId);
          await tx.update(records).set({applied:true,observedMediaId:mediaId}).where(and(eq(records.stageId,stage.id),eq(records.ordinal,record.ordinal)));
          await tx.update(stages).set({imported:sql`${stages.imported}+${decision==='remote'?1:0}`,review:sql`${stages.review}+${decision==='conflict'?1:0}`,updatedAt:new Date()}).where(eq(stages.id,stage.id));
        }});
        // Suppressed, unresolved and unsupported titles still have a durable
        // skip marker, so a retry cannot loop on the same record forever.
        if(!committed)await db.transaction(async tx=>{await assertLease(tx,userId,connectionId);await tx.update(records).set({applied:true}).where(and(eq(records.stageId,stage.id),eq(records.ordinal,record.ordinal)));});
        if(performance.now()-execution.started>=10_000)await jobCheckpoint();
      }
      if(!batch.length){
        const activity=await adapter.lastActivity();
        if(activity!==stage.activity){await restart(activity);continue;}
        await db.transaction(async tx=>{await assertLease(tx,userId,connectionId);await tx.update(stages).set({phase:options.skipCleanup?'done':'cleaning',updatedAt:new Date()}).where(eq(stages.id,stage.id));});
      }
      await reload();
      await jobCheckpoint();
      continue;
    }
    // Keep all observations until the entire absence pass finishes. Cursor and
    // each negative reconciliation commit together; partial fetch never enters here.
    const activity=await adapter.lastActivity();
    if(activity!==stage.activity){await restart(activity);continue;}
    if(category==='lists'){
      const previous=await db.select().from(syncListValues).where(and(eq(syncListValues.connectionId,connectionId),
        sql`(${stage.cleanedThrough}::uuid is null or ${syncListValues.listId}>${stage.cleanedThrough}::uuid)`,
        sql`not exists(select 1 from trakt_import_records r where r.stage_id=${stage.id} and r.observed_media_id=${syncListValues.listId})`
      )).orderBy(asc(syncListValues.listId)).limit(20);
      for(const entry of previous){
        await reconcileProviderList(userId,connectionId,entry.listId,{name:String(entry.remote.name??'Deleted list'),description:String(entry.remote.description??''),items:[],deleted:true},false,{accountGeneration:stage.accountGeneration,onReconciled:async(tx,decision)=>{
          await assertLease(tx,userId,connectionId);
          await tx.update(stages).set({cleanedThrough:entry.listId,review:sql`${stages.review}+${decision==='conflict'?1:0}`,updatedAt:new Date()}).where(eq(stages.id,stage.id));
        }});
        if(performance.now()-execution.started>=10_000)await jobCheckpoint();
      }
      if(!previous.length)await db.transaction(async tx=>{await assertLease(tx,userId,connectionId);await tx.update(stages).set({phase:'done',updatedAt:new Date()}).where(eq(stages.id,stage.id));await tx.delete(records).where(eq(records.stageId,stage.id));await tx.delete(stages).where(and(eq(stages.actionId,execution.id),sql`${stages.category} like 'list:%'`));});
      await reload();await jobCheckpoint();continue;
    }
    const previous=await db.select().from(syncValues).where(and(eq(syncValues.connectionId,connectionId),eq(syncValues.category,category),
      sql`(${stage.cleanedThrough}::uuid is null or ${syncValues.mediaId}>${stage.cleanedThrough}::uuid)`,
      sql`not exists(select 1 from trakt_import_records r where r.stage_id=${stage.id} and r.observed_media_id=${syncValues.mediaId})`
    )).orderBy(asc(syncValues.mediaId)).limit(20);
    for(const entry of previous){
      if(category==='collection'){
        const {isGeneratedProjection}=await import('$lib/collection/projection.server');
        if(await isGeneratedProjection(connectionId,entry.mediaId)){
          await db.transaction(async tx=>{await assertLease(tx,userId,connectionId);await tx.update(stages).set({cleanedThrough:entry.mediaId,updatedAt:new Date()}).where(eq(stages.id,stage.id));});
          continue;
        }
      }
      const remote=category==='ratings'?{value:null}:category==='progress'?{positionSeconds:0,durationSeconds:Number(entry.remote.durationSeconds)||0}:{value:false};
      await reconcileProviderValue(userId,connectionId,entry.mediaId,category as ValueCategory,remote,{source:'trakt',accountGeneration:stage.accountGeneration,onReconciled:async(tx,decision)=>{
        await assertLease(tx,userId,connectionId);
        await tx.update(stages).set({cleanedThrough:entry.mediaId,review:sql`${stages.review}+${decision==='conflict'?1:0}`,updatedAt:new Date()}).where(eq(stages.id,stage.id));
      }});
      if(performance.now()-execution.started>=10_000)await jobCheckpoint();
    }
    if(!previous.length)await db.transaction(async tx=>{
      await assertLease(tx,userId,connectionId);
      await tx.update(stages).set({phase:'done',updatedAt:new Date()}).where(eq(stages.id,stage.id));
      if(!options.retainRecords)await tx.delete(records).where(eq(records.stageId,stage.id));
    });
    await reload();
    await jobCheckpoint();
  }
}

/** Header census and every ordered member page are independently durable.
 * Personal list replacement remains one atomic conflict-aware reconciliation. */
export async function stagedTraktLists(userId:string,connectionId:string,adapter:TraktAdapter){
  type RemoteList=Awaited<ReturnType<TraktAdapter['listsPage']>>[number];
  const db=getDb();
  return stagedTraktCategory({userId,connectionId,category:'lists',adapter,
    readPage:async page=>(await adapter.listsPage(page)).map(remote=>({metadata:{remoteList:remote}})),
    apply:async(record,header)=>{
      const remote=record.metadata?.remoteList as RemoteList;
      const [local]=await db.transaction(async tx=>{
        await assertLease(tx,userId,connectionId);
        const [connection]=await tx.select().from(providerConnections).where(eq(providerConnections.id,connectionId));
        const mapped=Object.entries((connection.settings.exportedLists as Record<string,string>)??{}).find(([,id])=>id===String(remote.ids.trakt))?.[0];
        let [local]=await tx.select().from(lists).where(and(eq(lists.userId,userId),mapped?eq(lists.id,mapped):and(eq(lists.sourceConnectionId,connectionId),eq(lists.sourceAccountId,connection.syncAccountId!),eq(lists.externalId,String(remote.ids.trakt)))));
        const initial=typeof record.metadata?.initial==='boolean'?record.metadata.initial:!local;
        if(!local)[local]=await tx.insert(lists).values({userId,name:remote.name,description:remote.description,source:'trakt',sourceAccountId:connection.syncAccountId,sourceConnectionId:connectionId,externalId:String(remote.ids.trakt)}).returning();
        await tx.update(records).set({record:{...record,metadata:{...record.metadata,initial}}}).where(and(eq(records.stageId,header.stageId),eq(records.ordinal,header.ordinal)));
        return [{...local,initial}];
      });
      if(local.playlist)return;
      const members=await stagedTraktCategory({userId,connectionId,category:'watchlist',stageKey:`list:${remote.ids.trakt}`,adapter,skipCleanup:true,retainRecords:true,
        readPage:page=>adapter.listItemsPage(String(remote.ids.trakt),page),
        apply:async(record,member)=>{
          const item=await resolveTrakt(record);
          if(!item)return;
          await db.transaction(tx=>member.commit(tx,item.id,'agree'));
          return true;
        }
      });
      const mapped=await db.select({id:records.observedMediaId}).from(records).where(and(eq(records.stageId,members.stageId),sql`${records.observedMediaId} is not null`)).orderBy(asc(records.ordinal));
      await reconcileProviderList(userId,connectionId,local.id,{name:remote.name,description:(remote.description??'').split('\n').filter(line=>!line.startsWith('Coast reference: ')).join('\n').trim(),items:mapped.map(row=>row.id!)},local.initial,
        {accountGeneration:header.generation,initialSnapshot:{name:remote.name,description:remote.description??''},onReconciled:(tx,decision)=>header.commit(tx,local.id,decision==='conflict'?'conflict':'agree')});
      return true;
    }
  });
}
