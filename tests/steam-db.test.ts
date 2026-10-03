import { beforeAll, afterAll, describe, test, expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { getConfig } from '../src/lib/server/config';
import { configureInstance } from '../src/lib/providers/instances.server';
import { saveConnection } from '../src/lib/providers/connections.server';
import { disconnectProvider } from '../src/lib/application/provider-sources.server';
import { syncSteam, syncSteamAchievements } from '../src/lib/providers/steam/sync.server';
import { startSteam, finishSteam, updateSteamImports } from '../src/lib/providers/steam/connection.server';
import { listGames, gameDetails, importIgdbMetadata, createPlaythrough } from '../src/lib/core/games/service';
import { track } from '../src/lib/core/tracking/service';
import { workAssessments, collectionData } from '../src/lib/collection/query.server';
import { scheduleProviderMaintenance, updateProviderSchedule, runProviderJob } from '../src/lib/providers/maintenance.server';
import { enqueueAction, type OutboxAction } from '../src/lib/server/queue';
import { mapIgdbGame } from '../src/lib/providers/igdb/adapter.server';
const suite=process.env.TEST_DATABASE_URL?describe:describe.skip;
suite('Steam account imports and ownership availability',()=>{
  const fetchBefore=globalThis.fetch, databaseBefore=process.env.DATABASE_URL;
  const owner=crypto.randomUUID(),viewer=crypto.randomUUID(),steamId='76561198000000001';
  const key='0123456789abcdef0123456789abcdef';
  let instanceId:string,connectionId:string,gameId:string;
  let ownership:unknown={response:{game_count:1,games:[{appid:10,name:'Steam fixture',playtime_forever:125,playtime_2weeks:20,rtime_last_played:1700000000,has_community_visible_stats:true}]}};
  let privateStats=false,failOwned=false,remoteId=steamId;
  let remoteMinutes=125;
  const job=async(kind='steam.sync'):Promise<OutboxAction>=>{
    const [connection]=await getDb().select().from(s.providerConnections).where(eq(s.providerConnections.id,connectionId));
    return {id:crypto.randomUUID(),userId:owner,connectionId,kind,accountGeneration:connection.accountGeneration,payload:{},attempts:0,correlationId:crypto.randomUUID()};
  };
  beforeAll(async()=>{
    await closeDb();process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
    await getDb().insert(s.users).values([{id:owner,username:`steam-${owner}`,role:'admin',passwordHash:'fixture'},{id:viewer,username:`steam-${viewer}`,passwordHash:'fixture'}]);
    const config=await getConfig();await getDb().insert(s.systemSettings).values({key:'coast',value:{...config,experimentalFeatures:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalFeatures:true}}});
    instanceId=(await configureInstance(owner,{provider:'steam',name:'Fixture Steam',apiKey:key})).id;
    globalThis.fetch=(async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input)),headers=new Headers(init?.headers);
      expect(init?.redirect).toBe('manual');expect(url.searchParams.has('key')).toBe(false);
      if(headers.get('host')==='id.twitch.tv')return Response.json({access_token:'fixture-token',expires_in:3600,token_type:'bearer'});
      if(headers.get('host')==='api.igdb.com')return Response.json([{id:556,name:'Late enrichment fixture',external_games:[{uid:'777',url:'https://store.steampowered.com/app/777/'}]}]);
      if(headers.get('host')==='steamcommunity.com')return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n');
      expect(headers.get('host')).toBe('api.steampowered.com');expect(headers.get('x-webapi-key')).toBe(key);
      if(url.pathname.includes('GetPlayerSummaries'))return Response.json({response:{players:[{steamid:remoteId,personaname:'Fixture Steam user'}]}});
      if(url.pathname.includes('GetOwnedGames'))return Response.json(failOwned?{error:'offline'}:ownership,{status:failOwned?503:200});
      if(url.pathname.includes('GetSchemaForGame'))return Response.json({game:{availableGameStats:{achievements:[{name:'FIRST',displayName:'First',hidden:0},{name:'SECOND',displayName:'Second',hidden:1}]}}});
      if(url.pathname.includes('GetPlayerAchievements'))return Response.json({playerstats:{success:!privateStats,steamID:remoteId,achievements:[{apiname:'FIRST',achieved:1,unlocktime:0},{apiname:'SECOND',achieved:1,unlocktime:1700000000}]}});
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
    expect((await syncSteamAchievements(await job('steam.achievements'))).checked).toBe(1);
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
    expect((await gameDetails(owner,minimal.gameId)).title).toBe('Late enrichment fixture');
    expect((await getDb().select().from(s.gameExternalIds).where(eq(s.gameExternalIds.externalId,'556')))[0].gameId).toBe(minimal.gameId);
  });

});
