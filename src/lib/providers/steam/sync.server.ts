import { and, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb, type Database } from '$lib/server/db';
import * as s from '$lib/server/db/schema';
import { getSteam } from './connection.server';
import { steamOwnedGameSchema, type SteamOwnedGame } from './adapter.server';
import { ProviderHttpError } from '$lib/server/security/provider-fetch';
import { PermanentActionError, enqueueAction, type OutboxAction } from '$lib/server/queue';
import { trackInTransaction } from '$lib/core/tracking/service';
import { importIgdbMetadata } from '$lib/core/games/service';
import { igdbSteamMatches } from '../igdb/service.server';
import { jobExecution, JobYield, jobCheckpoint, readJobCheckpoint, saveJobCheckpoint } from '$lib/server/queue/execution';
type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
async function assertAccount(tx:Tx, action:OutboxAction, accountId:string) {
  // Reconnect/reset holds the connection before cancelling its outbox rows.
  // Keep the same lock order while fencing this worker's current attempt.
  const [connection]=await tx.select().from(s.providerConnections).where(and(eq(s.providerConnections.id,action.connectionId!),eq(s.providerConnections.userId,action.userId))).for('update');
  if(!connection||connection.status!=='connected'||connection.accountGeneration!==action.accountGeneration||connection.syncAccountId!==accountId)throw new PermanentActionError('The Steam account changed. Run the job for the current account.');
  const execution=jobExecution.getStore();
  if(execution?.id===action.id){
    const [lease]=await tx.select({id:s.outboxActions.id}).from(s.outboxActions)
      .where(and(eq(s.outboxActions.id,action.id),eq(s.outboxActions.state,'running'),eq(s.outboxActions.attempts,execution.attempts))).for('update');
    if(!lease)throw new JobYield();
  }
  const [instance]=await tx.select().from(s.providerInstances).where(eq(s.providerInstances.id,connection.instanceId));
  const [user]=await tx.select().from(s.users).where(eq(s.users.id,action.userId));
  if(!instance?.enabled||!user||user.disabled)throw new PermanentActionError('This account or Steam integration is disabled.');
  return connection;
}
async function steamGame(tx:Tx, item:SteamOwnedGame) {
  const externalId=String(item.appid);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`game:steam:${externalId}`},0))`);
  const [identity]=await tx.select().from(s.gameExternalIds).where(and(eq(s.gameExternalIds.provider,'steam'),eq(s.gameExternalIds.externalId,externalId)));
  if(identity)return identity.gameId;
  const [game]=await tx.insert(s.games).values({title:item.name,platforms:['PC (Steam)']}).returning();
  await tx.insert(s.gameExternalIds).values({gameId:game.id,provider:'steam',externalId});
  return game.id;
}
/** Complete ownership evidence is published only after every owned title was persisted. */
export async function syncSteam(action:OutboxAction) {
  if(!action.connectionId)throw new PermanentActionError('Choose a Steam account.');
  const {adapter,connection,instance}=await getSteam(action.userId,action.connectionId);
  if(!connection.syncAccountId)throw new PermanentActionError('Reconnect Steam to establish account provenance.');
  const accountId=connection.syncAccountId;
  await getDb().transaction(tx=>assertAccount(tx,action,accountId));
  const snapshotSchema=v.object({items:v.array(steamOwnedGameSchema),scanId:v.pipe(v.string(),v.uuid()),
    observedAt:v.pipe(v.string(),v.isoTimestamp()),next:v.pipe(v.number(),v.integer(),v.minValue(0)),added:v.pipe(v.number(),v.integer(),v.minValue(0))});
  const durable=jobExecution.getStore()?.id===action.id;
  const [stored]=durable?await getDb().select().from(s.providerJobSnapshots).where(eq(s.providerJobSnapshots.actionId,action.id)):[];
  if(stored && (stored.connectionId!==connection.id || stored.accountGeneration!==connection.accountGeneration))throw new PermanentActionError('The Steam account changed.');
  const snapshot=stored?v.parse(snapshotSchema,stored.data):{
    items:await adapter.ownedGames(connection.externalUserId!),scanId:crypto.randomUUID(),observedAt:new Date().toISOString(),next:0,added:0};
  if(!stored && durable)await getDb().transaction(async tx=>{
    await assertAccount(tx,action,accountId);
    await tx.insert(s.providerJobSnapshots).values({actionId:action.id,connectionId:connection.id,accountGeneration:connection.accountGeneration,data:snapshot});
  });
  const owned=snapshot.items,now=new Date(snapshot.observedAt),scanId=snapshot.scanId;
  let added=snapshot.added;
  for(let start=snapshot.next;start<owned.length;start+=100){
  await getDb().transaction(async tx=>{
    const current=await assertAccount(tx,action,accountId);
    for(const item of owned.slice(start,start+100)){
      const gameId=await steamGame(tx,item);
      const [previous]=await tx.select().from(s.gameAccountState).where(and(eq(s.gameAccountState.accountId,accountId),eq(s.gameAccountState.gameId,gameId)));
      const values={owned:true,hasStats:item.has_community_visible_stats,observedAt:now,
        ...(current.settings.importPlaytime!==false?{minutesPlayed:item.playtime_forever,recentMinutes:item.playtime_2weeks,lastPlayedAt:item.rtime_last_played?new Date(item.rtime_last_played*1000):null}:{})};
      await tx.insert(s.gameAccountState).values({accountId,gameId,...values}).onConflictDoUpdate({target:[s.gameAccountState.accountId,s.gameAccountState.gameId],set:values});
      if(!previous&&current.settings.importOwned!==false){
        const result=await trackInTransaction(tx,action.userId,{mediaId:gameId,action:'collect',value:true,source:'steam',sourceEventId:`${accountId}:${item.appid}:owned`,occurredAtKnown:false});
        if(result.changed)added++;
      }
      const [mapping]=await tx.insert(s.providerItems).values({instanceId:instance.id,mediaId:gameId,externalId:String(item.appid),kind:'game',snapshot:{title:item.name},lastSeenAt:now}).onConflictDoUpdate({target:[s.providerItems.instanceId,s.providerItems.externalId],set:{mediaId:gameId,lastSeenAt:now}}).returning();
      await tx.insert(s.availability).values({userId:action.userId,connectionId:current.id,providerItemId:mapping.id,mediaId:gameId,sourceId:'steam-owned',state:'available',source:{ownership:true,installed:null,authoritative:true},scanId,verifiedAt:now})
        .onConflictDoUpdate({target:[s.availability.userId,s.availability.connectionId,s.availability.providerItemId,s.availability.sourceId],set:{state:'available',scanId,verifiedAt:now,source:{ownership:true,installed:null,authoritative:true}}});
    }
    if(durable)await tx.update(s.providerJobSnapshots).set({data:sql`${s.providerJobSnapshots.data} || ${{next:Math.min(owned.length,start+100),added}}::jsonb`,updatedAt:new Date()}).where(eq(s.providerJobSnapshots.actionId,action.id));
  });
  await jobCheckpoint();
  }
  await getDb().transaction(async tx=>{
    await assertAccount(tx,action,accountId);
    await tx.update(s.availability).set({state:'unavailable',verifiedAt:now,scanId,source:{ownership:false,installed:null,authoritative:true}})
      .where(and(eq(s.availability.connectionId,connection.id),eq(s.availability.sourceId,'steam-owned'),sql`${s.availability.scanId} is distinct from ${scanId}::uuid`));
    await tx.update(s.gameAccountState).set({owned:false,observedAt:now}).where(and(eq(s.gameAccountState.accountId,accountId),sql`${s.gameAccountState.observedAt}<${now}`));
    await tx.insert(s.syncCheckpoints).values({connectionId:connection.id,kind:'steam-user',completedAt:now}).onConflictDoUpdate({target:[s.syncCheckpoints.connectionId,s.syncCheckpoints.kind],set:{completedAt:now,updatedAt:now}});
  });
  // Ownership is usable before optional shared game metadata is fetched.
  const [igdb]=await getDb().select({id:s.providerInstances.id}).from(s.providerInstances).where(and(eq(s.providerInstances.provider,'igdb'),eq(s.providerInstances.enabled,true),sql`${s.providerInstances.credentials} is not null`)).limit(1);
  if(igdb)await enqueueAction({userId:action.userId,kind:'igdb.steam-metadata',purpose:'scheduled',payload:{instanceId:igdb.id}});
  return {checked:owned.length,added,refreshed:owned.length-added};
}

/** Enrich exact Steam identities already in the shared pool, independently of
 * each account's ownership import. One finite pass; failures retain old metadata. */
export async function syncSteamMetadata(action:OutboxAction){
  if(typeof action.payload.instanceId!=='string')throw new PermanentActionError('Choose an IGDB service.');
  const [instance]=await getDb().select().from(s.providerInstances).where(and(eq(s.providerInstances.id,action.payload.instanceId),eq(s.providerInstances.provider,'igdb'),eq(s.providerInstances.enabled,true),sql`${s.providerInstances.credentials} is not null`));
  if(!instance)throw new PermanentActionError('The IGDB service is unavailable.');
  const schema=v.object({task:v.literal('steam-metadata'),ids:v.array(v.pipe(v.string(),v.regex(/^\d+$/))),next:v.pipe(v.number(),v.integer(),v.minValue(0)),refreshed:v.number(),deferred:v.number()});
  const saved=await readJobCheckpoint();
  const resume=saved?v.parse(schema,saved):null;
  const rows=resume?[]:await getDb().select({id:s.gameExternalIds.externalId}).from(s.gameExternalIds)
    .where(and(eq(s.gameExternalIds.provider,'steam'),sql`not exists(select 1 from provider_items pi join provider_instances i on i.id=pi.instance_id where i.provider='steam' and pi.external_id=game_external_ids.external_id and (pi.snapshot->>'steamMetadataAttemptedAt')::timestamptz>now()-interval '1 day')`,sql`(not exists(select 1 from game_external_ids ge where ge.game_id=game_external_ids.game_id and ge.provider='igdb') or not exists(select 1 from work_features f where f.work_id=game_external_ids.game_id and f.provider='igdb'))`))
    .orderBy(s.gameExternalIds.externalId).limit(500);
  const ids=resume?.ids??rows.map(row=>row.id);
  let refreshed=resume?.refreshed??0,deferred=resume?.deferred??0;
  for(let index=resume?.next??0;index<ids.length;index+=50){
    const batch=ids.slice(index,index+50);
    const matches=await igdbSteamMatches(instance.id,batch);
    const accepted=matches.filter(match=>match.identities.some(identity=>identity.provider==='steam'&&batch.includes(identity.externalId)));
    for(const match of accepted)await importIgdbMetadata(match);
    refreshed+=accepted.length;
    const matched=new Set(accepted.flatMap(match=>match.identities.filter(identity=>identity.provider==='steam').map(identity=>identity.externalId)));
    deferred+=batch.filter(id=>!matched.has(id)).length;
    // A successful empty match should not monopolize every bounded future pass.
    // Keep this shared metadata retry marker separate from personal ownership.
    await getDb().execute(sql`update provider_items pi set snapshot=pi.snapshot || jsonb_build_object('steamMetadataAttemptedAt',${new Date().toISOString()}::text)
      from provider_instances i where i.id=pi.instance_id and i.provider='steam' and pi.external_id in (${sql.join(batch.map(id=>sql`${id}`),sql`,`)})`);
    await saveJobCheckpoint({task:'steam-metadata',ids,next:Math.min(ids.length,index+50),refreshed,deferred});
    await jobCheckpoint();
  }
  return {checked:ids.length,refreshed,deferred};
}

export async function syncSteamAchievements(action:OutboxAction) {
  if(!action.connectionId)throw new PermanentActionError('Choose a Steam account.');
  const {adapter,connection}=await getSteam(action.userId,action.connectionId);
  if(connection.settings.importAchievements===false)return {checked:0};
  const accountId=connection.syncAccountId;
  if(!accountId)throw new PermanentActionError('Reconnect Steam to establish account provenance.');
  await getDb().transaction(tx=>assertAccount(tx,action,accountId));
  // Metadata may list unowned regional/demo AppIDs for the same game. Use the
  // exact AppIDs from this account's complete ownership scan, not every alias.
  const checkpoint=await readJobCheckpoint();
  const resume=checkpoint?.task==='steam-achievements'&&Array.isArray(checkpoint.titles)?checkpoint:null;
  type AchievementTitle={gameId:string;externalId:string};
  const savedTitles:AchievementTitle[]=resume?(resume.titles as unknown[]).filter((value):value is AchievementTitle=>!!value&&typeof value==='object'&&typeof (value as AchievementTitle).gameId==='string'&&typeof (value as AchievementTitle).externalId==='string').slice(0,20):[];
  // Freeze this bounded pass's exact AppIDs. Selecting another oldest-first
  // batch on resume would extend the same job indefinitely.
  const titles:AchievementTitle[]=resume?savedTitles:await getDb().select({gameId:s.gameAccountState.gameId,externalId:s.providerItems.externalId}).from(s.gameAccountState)
    .innerJoin(s.availability,and(eq(s.availability.mediaId,s.gameAccountState.gameId),eq(s.availability.userId,action.userId),eq(s.availability.connectionId,connection.id),eq(s.availability.sourceId,'steam-owned'),eq(s.availability.state,'available')))
    .innerJoin(s.providerItems,and(eq(s.providerItems.id,s.availability.providerItemId),eq(s.providerItems.instanceId,connection.instanceId),eq(s.providerItems.kind,'game')))
    .where(and(eq(s.gameAccountState.accountId,accountId),eq(s.gameAccountState.owned,true),eq(s.gameAccountState.hasStats,true)))
    .orderBy(sql`${s.gameAccountState.achievementsAttemptedAt} asc nulls first`,s.gameAccountState.gameId).limit(20);
  let checked=typeof resume?.checked==='number'?resume.checked:0,deferred=typeof resume?.deferred==='number'?resume.deferred:0;
  const start=typeof resume?.next==='number'?resume.next:0;
  await saveJobCheckpoint({task:'steam-achievements',titles,next:start,checked,deferred});
  for(let index=start;index<titles.length;index++){
    const title=titles[index];
    const [currentTitle]=await getDb().select({id:s.gameAccountState.gameId}).from(s.gameAccountState)
      .innerJoin(s.availability,and(eq(s.availability.mediaId,s.gameAccountState.gameId),eq(s.availability.connectionId,connection.id),eq(s.availability.sourceId,'steam-owned'),eq(s.availability.state,'available')))
      .innerJoin(s.providerItems,and(eq(s.providerItems.id,s.availability.providerItemId),eq(s.providerItems.externalId,title.externalId)))
      .where(and(eq(s.gameAccountState.accountId,accountId),eq(s.gameAccountState.gameId,title.gameId),eq(s.gameAccountState.owned,true),eq(s.gameAccountState.hasStats,true))).limit(1);
    if(currentTitle){
    try {
      const existing=await getDb().select().from(s.gameAchievements).where(and(eq(s.gameAchievements.gameId,title.gameId),eq(s.gameAchievements.provider,'steam')));
      const schema=!existing.length||existing.some(a=>a.updatedAt.getTime()<Date.now()-7*86400000)?await adapter.achievementSchema(Number(title.externalId)):null;
      const progress=await adapter.achievements(connection.externalUserId!,Number(title.externalId));
      await getDb().transaction(async tx=>{
        const current=await assertAccount(tx,action,accountId);
        if(current.settings.importAchievements===false)return;
        if(schema)for(const definition of schema)await tx.insert(s.gameAchievements).values({gameId:title.gameId,provider:'steam',externalId:definition.name,name:definition.displayName,description:definition.description,hidden:definition.hidden===1,icon:definition.icon,lockedIcon:definition.icongray})
          .onConflictDoUpdate({target:[s.gameAchievements.gameId,s.gameAchievements.provider,s.gameAchievements.externalId],set:{name:definition.displayName,description:definition.description,hidden:definition.hidden===1,icon:definition.icon,lockedIcon:definition.icongray,updatedAt:new Date()}});
        const definitions=await tx.select().from(s.gameAchievements).where(and(eq(s.gameAchievements.gameId,title.gameId),eq(s.gameAchievements.provider,'steam')));
        for(const item of progress){const definition=definitions.find(d=>d.externalId===item.apiname);if(!definition)continue;
          const values={unlocked:item.achieved===1,unlockedAt:item.achieved===1&&item.unlocktime>0?new Date(item.unlocktime*1000):null,updatedAt:new Date()};
          await tx.insert(s.gameAchievementProgress).values({accountId,achievementId:definition.id,...values}).onConflictDoUpdate({target:[s.gameAchievementProgress.accountId,s.gameAchievementProgress.achievementId],set:values});
        }
        await tx.update(s.gameAccountState).set({achievementsAt:new Date(),achievementsAttemptedAt:new Date()}).where(and(eq(s.gameAccountState.accountId,accountId),eq(s.gameAccountState.gameId,title.gameId)));
      });checked++;
    } catch(cause){
      if(cause instanceof PermanentActionError)throw cause;
      if(cause instanceof ProviderHttpError&&(cause.status===401||cause.status===403||cause.status===429||cause.status>=500))throw cause;
      await getDb().transaction(async tx=>{await assertAccount(tx,action,accountId);await tx.update(s.gameAccountState).set({achievementsAttemptedAt:new Date()}).where(and(eq(s.gameAccountState.accountId,accountId),eq(s.gameAccountState.gameId,title.gameId)));});deferred++;
    }
    }
    // Keep control flow outside the provider failure catch: ordinary yielding
    // must never count as a deferred/private achievement response.
    await saveJobCheckpoint({task:'steam-achievements',titles,next:index+1,checked,deferred});
    await jobCheckpoint();
  }
  return {checked,refreshed:checked,deferred};
}
