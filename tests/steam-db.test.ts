import { beforeAll, afterAll, describe, test, expect } from 'bun:test';
import { eq, sql as sq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { getConfig } from '../src/lib/server/config';
import { configureInstance } from '../src/lib/providers/instances.server';
import { saveConnection } from '../src/lib/providers/connections.server';
import { disconnectProvider } from '../src/lib/application/provider-sources.server';
import { syncSteam, syncSteamAchievements, syncSteamMetadata } from '../src/lib/providers/steam/sync.server';
import { startSteam, finishSteam, updateSteamImports } from '../src/lib/providers/steam/connection.server';
import { listGames, gameDetails, importIgdbMetadata, createPlaythrough } from '../src/lib/core/games/service.server';
import { track } from '../src/lib/core/tracking/service.server';
import { workAssessments, collectionData } from '../src/lib/collection/query.server';
import { scheduleProviderMaintenance, updateProviderSchedule, runProviderJob } from '../src/lib/providers/maintenance.server';
import { enqueueAction, type OutboxAction } from '../src/lib/server/queue';
import { mapIgdbGame } from '../src/lib/providers/igdb/adapter.server';
import { jobExecution, JobYield } from '../src/lib/server/queue/execution';
const suite=process.env.TEST_DATABASE_URL?describe:describe.skip;
suite('Steam account imports and ownership availability',()=>{
  const fetchBefore=globalThis.fetch, databaseBefore=process.env.DATABASE_URL;
  const owner=crypto.randomUUID(),viewer=crypto.randomUUID(),steamId='76561198000000001';
  const key='0123456789abcdef0123456789abcdef';
  let instanceId:string,connectionId:string,gameId:string;
  let ownership:unknown={response:{game_count:1,games:[{appid:10,name:'Steam fixture',playtime_forever:125,playtime_2weeks:20,rtime_last_played:1700000000,has_community_visible_stats:true}]}};
  let privateStats=false,failOwned=false,remoteId=steamId;
  let ownedReads=0,igdbReads=0,failIgdb=false;
  let deniedAppId:string|null=null,privacyDenial=true;
  let remoteMinutes=125;
  const achievementAppIds:string[]=[];
  const job=async(kind='steam.sync'):Promise<OutboxAction>=>{
    const [connection]=await getDb().select().from(s.providerConnections).where(eq(s.providerConnections.id,connectionId));
    return {id:crypto.randomUUID(),userId:owner,connectionId,kind,accountGeneration:connection.accountGeneration,payload:{},attempts:0,correlationId:crypto.randomUUID()};
  };
  beforeAll(async()=>{
    await closeDb();process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
    await getDb().insert(s.users).values([{id:owner,username:`steam-${owner}`,role:'admin',passwordHash:'fixture'},{id:viewer,username:`steam-${viewer}`,passwordHash:'fixture'}]);
    const config=await getConfig();await getDb().insert(s.systemSettings).values({key:'coast',value:{...config,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}});
    instanceId=(await configureInstance(owner,{provider:'steam',name:'Fixture Steam',apiKey:key})).id;
    globalThis.fetch=(async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input)),headers=new Headers(init?.headers);
      expect(init?.redirect).toBe('manual');expect(url.searchParams.has('key')).toBe(false);
      if(headers.get('host')==='id.twitch.tv')return Response.json({access_token:'fixture-token',expires_in:3600,token_type:'bearer'});
      if(headers.get('host')==='api.igdb.com'){igdbReads++;if(failIgdb)return Response.json({error:'offline'},{status:503});return Response.json([{id:556,name:'Late enrichment fixture',external_games:[{uid:'777',url:'https://store.steampowered.com/app/777/'}]}]);}
      if(headers.get('host')==='steamcommunity.com')return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n');
      expect(headers.get('host')).toBe('api.steampowered.com');expect(headers.get('x-webapi-key')).toBe(key);
      if(url.pathname.includes('GetPlayerSummaries'))return Response.json({response:{players:[{steamid:remoteId,personaname:'Fixture Steam user'}]}});
      if(url.pathname.includes('GetOwnedGames')){ownedReads++;return Response.json(failOwned?{error:'offline'}:ownership,{status:failOwned?503:200});}
      if(url.pathname.includes('GetSchemaForGame')||url.pathname.includes('GetPlayerAchievements')){
        const appId=url.searchParams.get('appid')!;achievementAppIds.push(appId);
        if(appId==='11')return Response.json({error:'Unowned regional version'},{status:403});
      }
      if(url.pathname.includes('GetSchemaForGame'))return Response.json({game:{availableGameStats:{achievements:[{name:'FIRST',displayName:'First',hidden:0},{name:'SECOND',displayName:'Second',hidden:1}]}}});
      if(url.pathname.includes('GetPlayerAchievements')){
        if(url.searchParams.get('appid')===deniedAppId)return Response.json(privacyDenial?{playerstats:{success:false,error:'Profile is not public'}}:{error:'Invalid Web API key'},{status:403});
        return Response.json({playerstats:{success:!privateStats,steamID:remoteId,achievements:[{apiname:'FIRST',achieved:1,unlocktime:0},{apiname:'SECOND',achieved:1,unlocktime:1700000000}]}});
      }
      throw new Error('Unexpected fixture endpoint');
    }) as typeof fetch;
  });
  afterAll(async()=>{globalThis.fetch=fetchBefore;await closeDb();if(databaseBefore===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=databaseBefore;});
  test('OpenID callback consumes one challenge and preserves same-account preferences on reconnect',async()=>{
    const link=await startSteam(owner,instanceId,'http://coast.test');
    const callback=new URL(new URL(link.url).searchParams.get('openid.return_to')!);
    const ns='http://specs.openid.net/auth/2.0';
    for(const [key,value]of Object.entries({ns,mode:'id_res',op_endpoint:'https://steamcommunity.com/openid/login',return_to:callback.toString(),identity:`https://steamcommunity.com/openid/id/${steamId}`,claimed_id:`https://steamcommunity.com/openid/id/${steamId}`,response_nonce:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')+'fixture',assoc_handle:'fixture',signed:'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',sig:'fixture'}))callback.searchParams.set(`openid.${key}`,value);
    connectionId=(await finishSteam(owner,callback)).id;
    await expect(finishSteam(owner,callback)).rejects.toThrow('Start Steam');
    expect((await job()).accountGeneration).toBeTruthy();
    expect((await getDb().select().from(s.syncAccounts))[0].externalUserId).toBe(steamId);
    await updateSteamImports(owner,connectionId,{importOwned:true,importPlaytime:true,importAchievements:true});
    await expect(updateSteamImports(viewer,connectionId,{importOwned:true,importPlaytime:true,importAchievements:true})).rejects.toThrow();
  });
  test('owned-game imports are idempotent, personal and do not manufacture sessions',async()=>{
    expect((await syncSteam(await job())).added).toBe(1);
    gameId=(await listGames('',1,{userId:owner})).items[0].id;
    expect((await syncSteam(await job())).added).toBe(0);
    expect((await listGames('',1,{userId:owner,availableOnly:true})).items.map(g=>g.id)).toEqual([gameId]);
    expect((await listGames('',1,{userId:viewer,personal:false,availableOnly:true})).total).toBe(0);
    expect((await collectionData(owner,{category:'game',availability:'available'})).total).toBe(1);
    expect((await workAssessments(owner,owner,[gameId]))[0].availability).toBe('available');
    expect((await workAssessments(viewer,viewer,[gameId]))[0].availability).toBe('unknown');
    expect((await gameDetails(owner,gameId)).steam[0].minutes_played).toBe(125);
    expect((await gameDetails(viewer,gameId)).steam).toEqual([]);
    expect((await getDb().select().from(s.gameSessions))).toEqual([]);
    expect((await getDb().select().from(s.gamePlaythroughs))).toEqual([]);
    await track(owner,{mediaId:gameId,action:'collect',value:false});
    await syncSteam(await job());expect((await collectionData(owner,{category:'game'})).total).toBe(0);
  });
  test('verified IGDB links enrich a Steam record without changing UUID or playthroughs',async()=>{
    await createPlaythrough(owner,gameId,{status:'in-progress',platform:'PC'});
    const imported=await importIgdbMetadata(mapIgdbGame({id:555,name:'Enriched fixture',external_games:[{uid:'10',url:'https://store.steampowered.com/app/10/'}]}));
    expect(imported.id).toBe(gameId);expect((await gameDetails(owner,gameId)).playthroughs.length).toBe(1);
    expect((await getDb().select().from(s.gameExternalIds)).length).toBe(2);
  });
  test('private, incomplete and failed reads preserve previous ownership; complete absence does not remove Collection',async()=>{
    await track(owner,{mediaId:gameId,action:'collect',value:true});
    const good=ownership;
    for(const bad of [{response:{}},{response:{game_count:2,games:[]}}]){ownership=bad;await expect(syncSteam(await job())).rejects.toThrow();expect((await listGames('',1,{userId:owner,availableOnly:true})).total).toBe(1);}
    failOwned=true;ownership=good;await expect(syncSteam(await job())).rejects.toThrow();failOwned=false;
    ownership={response:{game_count:0}};await syncSteam(await job());
    expect((await listGames('',1,{userId:owner,availableOnly:true})).total).toBe(0);
    expect((await workAssessments(owner,owner,[gameId]))[0].availability).toBe('unavailable');
    expect((await collectionData(owner,{category:'game'})).total).toBe(1);
    ownership=good;await syncSteam(await job());
  });
  test('achievement retries retain unknown dates and isolate private responses',async()=>{
    await getDb().insert(s.gameExternalIds).values({gameId,provider:'steam',externalId:'11'});
    expect((await syncSteamAchievements(await job('steam.achievements'))).checked).toBe(1);
    expect(achievementAppIds).not.toContain('11');expect(achievementAppIds).toContain('10');
    await syncSteamAchievements(await job('steam.achievements'));
    const progress=await getDb().select().from(s.gameAchievementProgress);
    expect(progress.length).toBe(2);expect(progress.filter(p=>p.unlockedAt===null).length).toBe(1);
    expect((await gameDetails(owner,gameId)).steam[0].unlocked).toBe(2);
    privateStats=true;expect((await syncSteamAchievements(await job('steam.achievements'))).deferred).toBe(1);privateStats=false;
    expect((await getDb().select().from(s.gameAchievementProgress))).toEqual(progress);
    await updateSteamImports(owner,connectionId,{importOwned:true,importPlaytime:false,importAchievements:false});
    ownership={response:{game_count:1,games:[{appid:10,name:'Steam fixture',playtime_forever:999,has_community_visible_stats:true}]}};
    await syncSteam(await job());expect((await gameDetails(owner,gameId)).steam[0].minutes_played).toBe(remoteMinutes);
    expect((await syncSteamAchievements(await job('steam.achievements'))).checked).toBe(0);
  });
  test('one private game retains progress and does not stop other games; invalid keys still fail',async()=>{
    const previousOwnership=ownership;
    await updateSteamImports(owner,connectionId,{importOwned:true,importPlaytime:false,importAchievements:true});
    ownership={response:{game_count:2,games:[{appid:10,name:'Steam fixture',playtime_forever:125,has_community_visible_stats:true},{appid:20,name:'Public achievements fixture',playtime_forever:5,has_community_visible_stats:true}]}};
    await syncSteam(await job());
    const [other]=await getDb().select().from(s.gameExternalIds).where(eq(s.gameExternalIds.externalId,'20'));
    const previousProgress=await getDb().select().from(s.gameAchievementProgress);
    try {
      await getDb().update(s.gameAccountState).set({achievementsAttemptedAt:null}).where(eq(s.gameAccountState.gameId,gameId));
      deniedAppId='10';
      expect(await syncSteamAchievements(await job('steam.achievements'))).toEqual({checked:1,refreshed:1,deferred:1});
      const progress=await getDb().select().from(s.gameAchievementProgress);
      expect(progress.filter(p=>previousProgress.some(old=>old.achievementId===p.achievementId))).toEqual(previousProgress);
      expect((await gameDetails(owner,other.gameId)).steam[0].unlocked).toBe(2);
      const [state]=await getDb().select().from(s.gameAccountState).where(eq(s.gameAccountState.gameId,gameId));
      expect(state.achievementsAttemptedAt).not.toBeNull();
      privacyDenial=false;
      await expect(syncSteamAchievements(await job('steam.achievements'))).rejects.toMatchObject({status:403});
    } finally {
      deniedAppId=null;privacyDenial=true;ownership=previousOwnership;
      await getDb().delete(s.games).where(eq(s.games.id,other.gameId));
      await updateSteamImports(owner,connectionId,{importOwned:true,importPlaytime:false,importAchievements:false});
    }
  });
  test('achievement chunks resume their original AppIDs and retain successful outcomes',async()=>{
    const previousOwnership=ownership;
    const action={...await job('steam.achievements'),attempts:1};
    try{
      await updateSteamImports(owner,connectionId,{importOwned:true,importPlaytime:false,importAchievements:true});
      ownership={response:{game_count:2,games:[{appid:10,name:'Steam fixture',playtime_forever:125,has_community_visible_stats:true},{appid:30,name:'Chunk achievements fixture',playtime_forever:0,has_community_visible_stats:true}]}};
      await syncSteam(await job());
      await getDb().insert(s.outboxActions).values({...action,state:'running'});
      const callsBefore=achievementAppIds.length;
      await expect(jobExecution.run({id:action.id,attempts:1,purpose:'scheduled',started:performance.now(),checkpoints:4},()=>syncSteamAchievements(action))).rejects.toBeInstanceOf(JobYield);
      const [paused]=await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.id,action.id));
      expect(paused.payload._checkpoint).toMatchObject({task:'steam-achievements',next:1,checked:1,deferred:0});
      const firstCalls=achievementAppIds.slice(callsBefore);
      const firstAppId=firstCalls[0];
      expect(firstCalls).toContain(firstAppId);
      const resumeCalls=achievementAppIds.length;
      const result=await jobExecution.run({id:action.id,attempts:1,purpose:'scheduled',started:performance.now(),checkpoints:0},()=>syncSteamAchievements(action));
      expect(result).toEqual({checked:2,refreshed:2,deferred:0});
      expect(achievementAppIds.slice(resumeCalls)).not.toContain(firstAppId);
      expect((await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.id,action.id)))[0].attempts).toBe(1);
    }finally{
      ownership=previousOwnership;
      await getDb().delete(s.outboxActions).where(eq(s.outboxActions.id,action.id));
      const [extra]=await getDb().select().from(s.gameExternalIds).where(eq(s.gameExternalIds.externalId,'30'));
      if(extra)await getDb().delete(s.games).where(eq(s.games.id,extra.gameId));
      await updateSteamImports(owner,connectionId,{importOwned:true,importPlaytime:false,importAchievements:false});
    }
  });
  test('scheduling respects pause, manual runs, one queued task and disabled achievement imports',async()=>{
    await getDb().delete(s.outboxActions);
    await updateProviderSchedule(owner,instanceId,{enabled:false});
    expect((await scheduleProviderMaintenance({instanceId})).queued).toBe(0);
    expect((await runProviderJob(owner,instanceId,'tracking')).queued).toBe(1);
    expect((await runProviderJob(owner,instanceId,'tracking')).queued).toBe(0);
    const first=await enqueueAction({userId:owner,connectionId,kind:'steam.sync',payload:{}});
    const second=await enqueueAction({userId:owner,connectionId,kind:'steam.sync',payload:{}});expect(first).toBe(second);
    expect((await runProviderJob(owner,instanceId,'users')).queued).toBe(0);
  });
  test('changed accounts reject old work and same-account reconnect keeps provenance and opt-outs',async()=>{
    const old=await job(),[before]=await getDb().select().from(s.providerConnections).where(eq(s.providerConnections.id,connectionId));
    await disconnectProvider(owner,connectionId);
    const failed=crypto.randomUUID(),outbound=crypto.randomUUID();
    await getDb().insert(s.outboxActions).values([
      {id:failed,userId:owner,connectionId,accountGeneration:before.accountGeneration,kind:'steam.sync',state:'failed',payload:{}},
      {id:outbound,userId:owner,connectionId,accountGeneration:before.accountGeneration,kind:'fixture.outbound',state:'failed',payload:{}}
    ]);
    await saveConnection(owner,instanceId,steamId,'Fixture',{});
    const [same]=await getDb().select().from(s.providerConnections).where(eq(s.providerConnections.id,connectionId));
    expect(same.syncAccountId).toBe(before.syncAccountId);expect(same.settings.importPlaytime).toBe(false);
    expect(same.accountGeneration).toBe(before.accountGeneration);
    const recovered=await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.id,failed));
    expect(recovered[0].state).toBe('cancelled');
    expect((await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.id,outbound)))[0].state).toBe('failed');
    await syncSteam(await job());
    await disconnectProvider(owner,connectionId);remoteId='76561198000000002';
    await saveConnection(owner,instanceId,remoteId,'Another',{});
    await expect(syncSteam(old)).rejects.toThrow('account changed');
    expect((await gameDetails(owner,gameId)).steam).toEqual([]);
    expect((await getDb().select().from(s.gameAccountState)).length).toBe(1);
  });
  test('a later IGDB connection enriches an existing Steam-only record while another mapped game exists',async()=>{
    ownership={response:{game_count:1,games:[{appid:777,name:'Minimal Steam fixture',playtime_forever:30}]}};
    await syncSteam(await job());
    const [minimal]=await getDb().select().from(s.gameExternalIds).where(eq(s.gameExternalIds.externalId,'777'));
    await configureInstance(owner,{provider:'igdb',name:'Fixture IGDB',clientId:'fixture-client',clientSecret:'fixture-secret'});
    await syncSteam(await job());
    expect((await gameDetails(owner,minimal.gameId)).title).toBe('Minimal Steam fixture');
    const [metadataJob]=await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.kind,'igdb.steam-metadata'));
    await syncSteamMetadata({id:metadataJob.id,userId:owner,connectionId:null,kind:metadataJob.kind,payload:metadataJob.payload,attempts:0,correlationId:crypto.randomUUID()});
    expect((await gameDetails(owner,minimal.gameId)).title).toBe('Late enrichment fixture');
    expect((await getDb().select().from(s.gameExternalIds).where(eq(s.gameExternalIds.externalId,'556')))[0].gameId).toBe(minimal.gameId);
  });

  test('a cancelled worker cannot apply an empty census or publish ownership removals',async()=>{
    const action={...await job(),attempts:1},original=ownership;
    const before=await getDb().select().from(s.availability).where(eq(s.availability.connectionId,connectionId));
    const reads=ownedReads;
    try{
      ownership={response:{game_count:0}};
      await getDb().insert(s.outboxActions).values({...action,state:'cancelled'});
      await expect(jobExecution.run({id:action.id,attempts:1,purpose:'bootstrap',started:performance.now(),checkpoints:0},()=>syncSteam(action))).rejects.toBeInstanceOf(JobYield);
      expect(ownedReads).toBe(reads);
      expect(await getDb().select().from(s.availability).where(eq(s.availability.connectionId,connectionId))).toEqual(before);
    }finally{ownership=original;await getDb().delete(s.outboxActions).where(eq(s.outboxActions.id,action.id));}
  });

  test('ownership resumes the retained census, publishes absence only at completion and ignores optional IGDB outages',async()=>{
    const original=ownership, action={...await job(),attempts:1};
    const beforeOwned=ownedReads,beforeIgdb=igdbReads;
    const originalAvailable=(await getDb().select().from(s.availability).where(eq(s.availability.connectionId,connectionId))).filter(row=>row.state==='available');
    ownership={response:{game_count:111,games:Array.from({length:111},(_,index)=>({appid:8000+index,name:`Chunk game ${index}`,playtime_forever:0}))}};
    failIgdb=true;
    try{
      await getDb().insert(s.outboxActions).values({...action,state:'running'});
      await expect(jobExecution.run({id:action.id,attempts:1,purpose:'bootstrap',started:performance.now(),checkpoints:4},()=>syncSteam(action))).rejects.toBeInstanceOf(JobYield);
      const [snapshot]=await getDb().select().from(s.providerJobSnapshots).where(eq(s.providerJobSnapshots.actionId,action.id));
      expect(snapshot.data.next).toBe(100);
      const during=await getDb().select().from(s.availability).where(eq(s.availability.connectionId,connectionId));
      expect(originalAvailable.every(old=>during.some(row=>row.id===old.id&&row.state==='available'))).toBe(true);
      // A changing upstream result must not silently replace the retained census.
      ownership={response:{game_count:0}};
      const outcome=await jobExecution.run({id:action.id,attempts:1,purpose:'bootstrap',started:performance.now(),checkpoints:0},()=>syncSteam(action));
      expect(outcome.checked).toBe(111);expect(ownedReads-beforeOwned).toBe(1);expect(igdbReads).toBe(beforeIgdb);
      const complete=await getDb().select().from(s.availability).where(eq(s.availability.connectionId,connectionId));
      expect(complete.filter(row=>row.state==='available')).toHaveLength(111);
      await getDb().update(s.outboxActions).set({state:'succeeded'}).where(eq(s.outboxActions.id,action.id));
      expect(await getDb().select().from(s.providerJobSnapshots).where(eq(s.providerJobSnapshots.actionId,action.id))).toHaveLength(0);
    }finally{
      ownership=original;failIgdb=false;
      await getDb().delete(s.outboxActions).where(eq(s.outboxActions.id,action.id));
      await getDb().execute(sq`delete from games where id in(select game_id from game_external_ids where provider='steam' and external_id::integer between 8000 and 8110)`);
    }
  });

});
