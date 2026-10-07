import {and,eq,sql} from 'drizzle-orm';
import {getDb,type Database} from '$lib/server/db';
import {providerConnections,providerInstances,users,outboxActions,socialLiveState} from '$lib/server/db/schema';
import {getJellyfin} from './connection.server';
import {providerSchedule} from '../schedule';
import {ProviderHttpError} from '$lib/server/security/provider-fetch';
import {PermanentActionError,type OutboxAction} from '$lib/server/queue';
import {assertJobLease,jobCheckpoint,readJobCheckpoint,saveJobCheckpoint} from '$lib/server/queue/execution';
import {companionPlan,validateCompanionPage,type CompanionPage,type CompanionState} from './companion';
import {streamPresentation} from './streams';
import {recordServerStreams} from './stream-history.server';
import {getConfig} from '$lib/server/config';
import {syncJellyfinChanges} from '$lib/sync/jellyfin';
import * as v from 'valibot';

type Context=Awaited<ReturnType<typeof getJellyfin>>;
type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
type State=CompanionState & {baselineIds?:string[]};
async function lockSource(tx:Tx,context:Context){
  const [instance]=await tx.select().from(providerInstances).where(eq(providerInstances.id,context.instance.id)).for('update');
  const [account]=await tx.select({connection:providerConnections,user:users}).from(providerConnections).innerJoin(users,eq(users.id,providerConnections.userId))
    .where(eq(providerConnections.id,context.connection.id)).for('update',{of:providerConnections});
  if(!instance?.enabled||instance.serverIdentity!==context.instance.serverIdentity||!account||account.user.disabled||account.user.role!=='admin'
    ||account.connection.status!=='connected'||account.connection.userId!==context.connection.userId||account.connection.accountGeneration!==context.connection.accountGeneration)
    throw new PermanentActionError('The companion source account changed.');
  await assertJobLease(tx,true);
  return instance;
}
function stateFor(context:Context):State|undefined{
  const state=context.instance.settings.companion as State|undefined;
  return state?.connectionId===context.connection.id&&state.generation===context.connection.accountGeneration?state:undefined;
}
/** Explicit reset/gaps queue complete reconciliation. The acknowledgement and all
 * follow-up jobs commit together, so lost HTTP replies cannot lose observations. */
export async function applyCompanionPage(action:OutboxAction,context:Context,page:CompanionPage,checkedAt=new Date()){
  const previous=stateFor(context);
  validateCompanionPage(page,previous??{},context.instance.serverIdentity!);
  const plan=companionPlan(page),schedule=providerSchedule('jellyfin',context.instance.settings.schedule);
  if(schedule.streamsEnabled){
    await recordServerStreams({connectionId:context.connection.id,generation:context.connection.accountGeneration,checkedAt,action},
      page.sessions.flatMap(session=>{const stream=streamPresentation(session);return stream?[stream]:[];}));
  }
  const config=await getConfig();
  return getDb().transaction(async tx=>{
    const current=await lockSource(tx,context);
    const saved=current.settings.companion as State|undefined;
    // Another source/run cannot acknowledge over a changed cursor or configuration.
    if(JSON.stringify(saved??null)!==JSON.stringify(context.instance.settings.companion??null))throw new Error('The companion cursor changed; retry this page.');
    const accounts=await tx.select({connection:providerConnections}).from(providerConnections).innerJoin(users,eq(users.id,providerConnections.userId))
      .where(and(eq(providerConnections.instanceId,current.id),eq(providerConnections.status,'connected'),eq(users.disabled,false))).orderBy(providerConnections.id).for('update',{of:providerConnections});
    let queued=0;
    const request=async(connection:typeof providerConnections.$inferSelect,kind:string,payload:Record<string,unknown>,key:string)=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${connection.userId}:${connection.id}`},0))`);
      const shared=kind==='jellyfin.library';
      const [existing]=await tx.select({id:outboxActions.id}).from(outboxActions).innerJoin(providerConnections,eq(providerConnections.id,outboxActions.connectionId))
        .where(and(eq(outboxActions.kind,kind),shared?eq(providerConnections.instanceId,current.id):eq(outboxActions.connectionId,connection.id),eq(outboxActions.compactionKey,key),
          sql`${outboxActions.accountGeneration}=${providerConnections.accountGeneration}`,sql`${outboxActions.state} in ('pending','running','failed')`)).limit(1);
      if(existing){
        if(shared&&payload.full===true)await tx.execute(sql`update outbox_actions set payload=payload||case when state='pending' then '{"full":true}'::jsonb else '{"_followupFull":true}'::jsonb end where id=${existing.id}`);
        return existing.id;
      }
      const [job]=await tx.insert(outboxActions).values({userId:connection.userId,connectionId:connection.id,accountGeneration:connection.accountGeneration,kind,compactionKey:key,
        payload:{...payload,_manual:action.payload._manual===true,_jobPurpose:action.payload._manual===true?'manual':'live'},createdAt:sql`clock_timestamp()`}).returning({id:outboxActions.id});
      queued++;return job.id;
    };
    const baselineIds=page.reset?[]:[...(previous?.baselineIds??[])];
    const librarySource=accounts.find(a=>a.connection.id===schedule.libraryConnectionId)?.connection
      ??(!schedule.libraryConnectionId?context.connection:undefined);
    if(page.reset){
      // Revoke cached census proofs after lost events; initial imports still keep their own cursors.
      await tx.execute(sql`update provider_instances set settings=settings-'screenLibraryCensus' where id=${current.id}`);
      if(schedule.libraryEnabled&&librarySource)baselineIds.push(await request(librarySource,'jellyfin.library',{full:true},'jellyfin.library'));
      if(schedule.userSyncEnabled)for(const {connection} of accounts)baselineIds.push(await request(connection,'jellyfin.sync',{},'jellyfin.sync'));
    }else{
      if(plan.items.length)await tx.execute(sql`update provider_instances set settings=settings-'screenLibraryCensus' where id=${current.id}`);
      if(plan.removed.length){
        // A server deletion is authoritative for this instance, never for another server.
        await tx.execute(sql`update availability a set state='unavailable',verified_at=${checkedAt}
          from provider_items pi where a.provider_item_id=pi.id and pi.instance_id=${current.id}
          and pi.external_id in (${sql.join(plan.removed.map(id=>sql`${id}`),sql`,`)})`);
      }
      if(schedule.libraryEnabled&&librarySource&&(plan.video.length||config.experimentalMusic&&plan.music.length))
        await request(librarySource,'jellyfin.delta',{scope:'library',video:plan.video,music:config.experimentalMusic?plan.music:[]},`companion:${page.epoch}:${page.cursor}:library`);
      for(const {connection} of accounts){
        const personal=connection.externalUserId?plan.personal.get(connection.externalUserId.replaceAll('-','').toLowerCase()):undefined;
        if(personal?.permissions){
          // Permission edits invalidate access immediately; only this account's authenticated import grants it again.
          await tx.execute(sql`update availability set state='unavailable',verified_at=${checkedAt} where connection_id=${connection.id}`);
          await tx.execute(sql`update sync_checkpoints set cursor=null,scan_id=null,completed_at=null where connection_id=${connection.id} and kind='jellyfin-user'`);
          if(schedule.userSyncEnabled)await request(connection,'jellyfin.sync',{},'jellyfin.sync');
          continue;
        }
        if(!schedule.userSyncEnabled)continue;
        const video=[...new Set([...plan.video,...(personal?.video??[])])];
        const music=config.experimentalMusic?[...new Set([...plan.music,...(personal?.music??[])])]:[];
        if(video.length||music.length)await request(connection,'jellyfin.delta',{scope:'user',video,music},`companion:${page.epoch}:${page.cursor}:user`);
      }
    }
    if(schedule.liveEnabled){
      for(const {connection} of accounts){
        if(connection.settings.liveRead===false)continue;
        const session=page.sessions.find(s=>s.UserId?.replaceAll('-','').toLowerCase()===connection.externalUserId?.replaceAll('-','').toLowerCase()&&s.NowPlayingItem&&!s.PlayState?.IsPaused);
        const remoteId=session?.NowPlayingItem?.Id??null;
        const [work]=remoteId?await tx.execute<{id:string}>(sql`select media_id as id from provider_items where instance_id=${current.id} and external_id=${remoteId} union select work_id as id from work_editions where instance_id=${current.id} and external_id=${remoteId} limit 1`):[];
        const value={connectionId:connection.id,accountGeneration:connection.accountGeneration,workId:work?.id??null,remoteId,checkedAt,expiresAt:remoteId?new Date(checkedAt.getTime()+Math.min(30,Math.max(3,schedule.updatesIntervalMinutes*3))*60000):null};
        await tx.insert(socialLiveState).values(value).onConflictDoUpdate({target:socialLiveState.connectionId,set:value});
      }
    }
    const outstanding=baselineIds.length?(await tx.execute(sql`
      select a.id from outbox_actions a where a.id in (${sql.join(baselineIds.map(id=>sql`${id}::uuid`),sql`,`)}) and a.state<>'succeeded'
      and not exists(select 1 from outbox_actions completed where completed.connection_id=a.connection_id
        and completed.account_generation=a.account_generation and completed.kind=a.kind and completed.state='succeeded'
        and completed.created_at>=a.created_at)`) as {id:string}[]):[];
    const [failed]=await tx.execute(sql`select a.id from outbox_actions a join provider_connections c on c.id=a.connection_id
      where c.instance_id=${current.id} and a.account_generation=c.account_generation and a.kind='jellyfin.delta' and a.state='failed' limit 1`);
    const state:State={connectionId:context.connection.id,generation:context.connection.accountGeneration,epoch:page.epoch,cursor:page.cursor,checkedAt:checkedAt.toISOString(),
      status:page.more||outstanding.length||failed?'reconciling':'healthy',baselineIds:outstanding.map(job=>job.id)};
    await tx.update(providerInstances).set({settings:sql`jsonb_set(${providerInstances.settings},'{companion}',${state}::jsonb,true)`}).where(eq(providerInstances.id,current.id));
    return {checked:page.changes.length,queued};
  });
}
export async function pollCompanion(action:OutboxAction){
  if(!action.connectionId)throw new PermanentActionError('The companion source account is unavailable.');
  let checked=0;
  for(;;){
    const context=await getJellyfin(action.userId,action.connectionId);
    if(context.connection.accountGeneration!==action.accountGeneration)throw new PermanentActionError('The companion source account changed.');
    const previous=stateFor(context);
    let page:CompanionPage;
    try{page=await context.adapter.companionChanges(previous?.epoch,previous?.cursor??0);}
    catch(error){
      await getDb().transaction(async tx=>{await lockSource(tx,context);
        const state:State={...previous,connectionId:context.connection.id,generation:context.connection.accountGeneration,checkedAt:new Date().toISOString(),status:'unavailable',
          reason:error instanceof ProviderHttpError&&error.status===404?'Plugin not installed or live updates disabled':'Plugin updates unavailable; native polling retained'};
        await tx.update(providerInstances).set({settings:sql`jsonb_set(${providerInstances.settings},'{companion}',${state}::jsonb,true)`}).where(eq(providerInstances.id,context.instance.id));
      });
      if(error instanceof ProviderHttpError&&error.status===404)return {checked:0,deferred:1};
      throw error;
    }
    const result=await applyCompanionPage(action,context,page);
    checked+=result.checked;
    if(!page.more)return {checked};
    await jobCheckpoint();
  }
}
const ids=v.pipe(v.array(v.pipe(v.string(),v.regex(/^[a-f0-9]{32}$/i))),v.maxLength(200));
export async function applyCompanionDelta(action:OutboxAction){
  if(!action.connectionId)throw new PermanentActionError('The Jellyfin connection is unavailable.');
  const data=v.parse(v.object({scope:v.picklist(['library','user']),video:ids,music:ids}),action.payload);
  const context=await getJellyfin(action.userId,action.connectionId);
  if(context.connection.accountGeneration!==action.accountGeneration)throw new PermanentActionError('The connected account changed.');
  const items=[...data.video.map(id=>({id,kind:'video' as const})),...data.music.map(id=>({id,kind:'music' as const}))];
  if(items.length>200)throw new PermanentActionError('Too many Jellyfin changes in one page.');
  const saved=v.safeParse(v.object({offset:v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(items.length)),
    checked:v.pipe(v.number(),v.integer(),v.minValue(0)),count:v.pipe(v.number(),v.integer(),v.minValue(0))}),await readJobCheckpoint());
  let {offset,checked,count}=saved.success?saved.output:{offset:0,checked:0,count:0};
  // Commit small targeted batches before yielding, keeping long bursts from
  // holding a worker and preserving completed work across retries/promotions.
  while(offset<items.length){
    const batch=items.slice(offset,offset+25);
    const result=await syncJellyfinChanges(action.userId,action.connectionId,data.scope,
      {video:batch.filter(item=>item.kind==='video').map(item=>item.id),music:batch.filter(item=>item.kind==='music').map(item=>item.id)},context);
    offset+=batch.length;checked+=result.checked;count+=result.count;
    await saveJobCheckpoint({offset,checked,count});
    await jobCheckpoint();
  }
  return {checked,count,full:false};
}
