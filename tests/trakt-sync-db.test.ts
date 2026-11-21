import * as network from '../src/lib/server/security/provider-fetch';
import { encryptCredential } from '../src/lib/server/security/credentials';
import { startCheckin } from '../src/lib/social/checkins.server';
import { deliverCheckin } from '../src/lib/social/trakt.server';
import { trackWithExports } from '../src/lib/sync/changes.server';
import { createList } from '../src/lib/core/lists/service.server';
import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import { ingestMetadata } from '../src/lib/catalogue/service.server';
import { resolveTrakt } from '../src/lib/catalogue/trakt-identity.server';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { executeTraktListExport, exportTraktListToAdapter } from '../src/lib/sync/trakt-lists.server';
import { executeLiveScrobble, executeProgressExport, executeTraktExport, exportTraktToAdapter } from '../src/lib/sync/trakt-export.server';
import { importTraktFromAdapter } from '../src/lib/sync/trakt-import.server';
import { externalIds, listItems, lists, media, outboxActions, providerConnections, providerInstances, ratings, seasons, socialLiveDeliveries, socialScrobbleDeliveries, trackingEvents, trackingState, users } from '../src/lib/server/db/schema';
import { jobExecution, JobYield } from '../src/lib/server/queue/execution';
import type { SyncPreferences } from '../src/lib/providers/contracts';

const enabled = process.env.COAST_DB_TEST === '1';
const run = enabled ? test : test.skip;
const prefix = crypto.randomUUID();
const numericId = 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
const sync: SyncPreferences = {history:false,progress:false,collection:false,ratings:true,watchlist:true,lists:true,scrobble:false};
let userId: string, otherId: string, instanceId: string, showId: string, seasonId: string, movieId: string, extraMovieId: string;
let connection: typeof providerConnections.$inferSelect;
const mediaIds: string[] = [];
const show = {title:`Trakt fixture ${prefix}`,ids:{trakt:numericId}};
const season = {number:1,ids:{trakt:numericId}};
const remoteListId = numericId + 20;
const remoteItems = [
  {id:300,type:'season',season,show},
  {id:200,type:'movie',movie:{title:'Movie sharing show ID',ids:{trakt:numericId}}},
  {id:100,type:'show',show},
];

beforeAll(async()=>{
  if(!enabled)return;
  const actors=await getDb().insert(users).values([{username:`trakt-domain-${prefix}`,passwordHash:'fixture'},{username:`trakt-other-${prefix}`,passwordHash:'fixture'}]).returning();
  [userId,otherId]=actors.map(actor=>actor.id);
  const [instance]=await getDb().insert(providerInstances).values({provider:'trakt',name:`Trakt fixture ${prefix}`,baseUrl:'https://fixture.invalid'}).returning();
  instanceId=instance.id;
  [connection]=await getDb().insert(providerConnections).values({userId,instanceId,externalUserId:'fixture',settings:{sync}}).returning();
  const canonicalShow=await ingestMetadata({provider:'trakt',externalId:String(numericId),kind:'show',title:show.title});
  showId=canonicalShow.id;mediaIds.push(showId);
  const canonicalSeason=await ingestMetadata({provider:'trakt',externalId:`${numericId}:season:1`,kind:'season',title:'Season 1',seasonNumber:1},{showId});
  seasonId=canonicalSeason.id;mediaIds.push(seasonId);
  const movie=await ingestMetadata({provider:'trakt',externalId:String(numericId),kind:'movie',title:'Movie sharing show ID'});
  movieId=movie.id;mediaIds.push(movieId);
  const extraMovie=await ingestMetadata({provider:'trakt',externalId:String(numericId+9),kind:'movie',title:'Movie sharing absent show ID'});
  extraMovieId=extraMovie.id;mediaIds.push(extraMovieId);
  await getDb().insert(ratings).values({userId,mediaId:seasonId,value:4.5,source:'coast'});
});
afterAll(async()=>{
  if(!enabled)return;
  if(showId){const imported=await getDb().select({id:seasons.mediaId}).from(seasons).where(eq(seasons.showId,showId));mediaIds.push(...imported.map(item=>item.id));}
  if(userId)await getDb().delete(users).where(inArray(users.id,[userId,otherId]));
  if(instanceId)await getDb().delete(providerInstances).where(eq(providerInstances.id,instanceId));
  if(mediaIds.length)await getDb().delete(media).where(inArray(media.id,[...new Set(mediaIds)]));
});

run('season ratings, watchlist and mixed-list imports preserve season identity and Coast ratings',async()=>{
  const paths:string[]=[];
  const adapter=new TraktAdapter(async(path)=>{
    paths.push(path);const route=path.split('?')[0];
    if(route==='/sync/ratings')return[{...remoteItems[0],rating:2,rated_at:'2026-01-01T00:00:00.000Z'},{type:'season',season:{number:2,ids:{trakt:numericId+2}},show,rating:5,rated_at:'2026-01-02T00:00:00.000Z'}];
    if(route==='/sync/watchlist')return[{...remoteItems[0],listed_at:'2026-01-03T00:00:00.000Z'}];
    if(route==='/users/me/lists')return[{name:'Mixed fixture list',ids:{trakt:remoteListId,slug:'fixture'}}];
    if(route===`/users/me/lists/${remoteListId}/items/movie,show,season,episode`)return remoteItems;
    throw new Error(`Unexpected fixture read ${route}`);
  },'fixture-client','fixture-secret');
  await importTraktFromAdapter(userId,connection.id,{adapter,sync});
  await importTraktFromAdapter(userId,connection.id,{adapter,sync});
  const importedSeasons=await getDb().select().from(seasons).where(eq(seasons.showId,showId));
  expect(importedSeasons).toHaveLength(2);
  expect(importedSeasons.find(item=>item.seasonNumber===1)?.mediaId).toBe(seasonId);
  const storedRatings=await getDb().select().from(ratings).where(eq(ratings.userId,userId));
  expect(storedRatings.find(item=>item.mediaId===seasonId)).toMatchObject({value:4.5,source:'coast'});
  expect(storedRatings.find(item=>item.mediaId===importedSeasons.find(season=>season.seasonNumber===2)?.mediaId)).toMatchObject({value:2.5,source:'trakt'});
  expect(storedRatings.some(item=>item.mediaId===showId)).toBe(false);
  const states=await getDb().select().from(trackingState).where(eq(trackingState.userId,userId));
  expect(states).toHaveLength(1);expect(states[0]).toMatchObject({mediaId:seasonId,watchlist:true});
  const events=await getDb().select().from(trackingEvents).where(and(eq(trackingEvents.userId,userId),eq(trackingEvents.mediaId,seasonId)));
  expect(events).toHaveLength(1);
  const [list]=await getDb().select().from(lists).where(eq(lists.userId,userId));
  expect(list).toMatchObject({source:'trakt',sourceConnectionId:connection.id});
  const members=await getDb().select().from(listItems).where(eq(listItems.listId,list.id)).orderBy(listItems.position);
  expect(members.map(item=>item.mediaId)).toEqual([seasonId,movieId,showId]);
  const mappings=await getDb().select().from(externalIds).where(and(eq(externalIds.externalId,String(numericId)),eq(externalIds.provider,'trakt')));
  expect(mappings.map(item=>item.mediaKind).sort()).toEqual(['movie','season','show']);
  expect(paths.every(path=>!path.includes('/history')&&!path.includes('/playback')&&!path.includes('/collection'))).toBe(true);
});

run('season rating and watchlist exports use real season IDs and respect category opt-outs',async()=>{
  const calls:{path:string;body:Record<string,unknown>}[]=[];
  const adapter=new TraktAdapter(async(path,init)=>{
    calls.push({path,body:JSON.parse(String(init?.body))});
    return {[path.endsWith('/remove')?'deleted':'added']:{seasons:1},not_found:{}};
  },'fixture-client','fixture-secret');
  await exportTraktToAdapter(userId,{mediaId:seasonId,category:'ratings',value:4.5},{adapter,sync});
  await exportTraktToAdapter(userId,{mediaId:seasonId,category:'watchlist',remove:true},{adapter,sync});
  await exportTraktToAdapter(userId,{mediaId:seasonId,category:'watchlist'},{adapter,sync:{...sync,watchlist:false}});
  expect(calls).toEqual([
    {path:'/sync/ratings',body:{seasons:[{ids:{trakt:numericId},rating:9}]}},
    {path:'/sync/watchlist/remove',body:{seasons:[{ids:{trakt:numericId}}]}},
  ]);
  const unmatchable=await ingestMetadata({provider:'trakt',externalId:`${numericId}:season:3`,kind:'season',title:'Season 3',seasonNumber:3},{showId});
  mediaIds.push(unmatchable.id);
  await expect(exportTraktToAdapter(userId,{mediaId:unmatchable.id,category:'ratings',value:4},{adapter,sync})).rejects.toThrow('no identity Trakt can match');
  expect(calls).toHaveLength(2);
});

run('committed Trakt categories and lists resume without replaying or revoking their members',async()=>{
  const id=crypto.randomUUID();
  await getDb().insert(outboxActions).values({id,userId,connectionId:connection.id,accountGeneration:connection.accountGeneration,kind:'trakt.import',payload:{},state:'running',attempts:1});
  const reads:string[]=[];
  const adapter=new TraktAdapter(async(path)=>{
    const route=path.split('?')[0];
    if(route==='/sync/last_activities')return{all:'2026-01-01T00:00:00.000Z'};
    reads.push(route);
    if(route==='/sync/ratings')return[{...remoteItems[0],rating:2,rated_at:'2026-01-01T00:00:00.000Z'},{type:'season',season:{number:2,ids:{trakt:numericId+2}},show,rating:5,rated_at:'2026-01-02T00:00:00.000Z'}];
    if(route==='/sync/watchlist')return[{...remoteItems[0],listed_at:'2026-01-03T00:00:00.000Z'}];
    if(route==='/users/me/lists')return[{name:'Mixed fixture list',ids:{trakt:remoteListId,slug:'fixture'}}];
    if(route===`/users/me/lists/${remoteListId}/items/movie,show,season,episode`)return remoteItems;
    throw new Error(`Unexpected fixture read ${route}`);
  },'fixture-client','fixture-secret');
  const execute=(checkpoints:number)=>jobExecution.run({id,attempts:1,purpose:'scheduled',started:performance.now(),checkpoints},()=>importTraktFromAdapter(userId,connection.id,{adapter,sync}));
  try{
    let yields=0,complete=false;
    for(let chunk=0;chunk<30;chunk++){
      try{await execute(4);complete=true;break;}catch(error){if(!(error instanceof JobYield))throw error;yields++;}
    }
    expect(yields).toBeGreaterThan(3);
    expect(complete).toBe(true);
    const [paused]=await getDb().select().from(outboxActions).where(eq(outboxActions.id,id));
    expect(paused.payload._checkpoint).toMatchObject({task:'trakt-import',categories:['ratings','watchlist']});
    const before=reads.length;
    await execute(0);
    expect(reads.slice(before)).toEqual([]);
    expect(reads.filter(path=>path==='/sync/ratings')).toHaveLength(1);
    expect(reads.filter(path=>path==='/sync/watchlist')).toHaveLength(1);
    const [list]=await getDb().select().from(lists).where(eq(lists.userId,userId));
    const members=await getDb().select().from(listItems).where(eq(listItems.listId,list.id)).orderBy(listItems.position);
    expect(members.map(item=>item.mediaId)).toEqual([seasonId,movieId,showId]);
  }finally{await getDb().delete(outboxActions).where(eq(outboxActions.id,id));}
});

run('mixed-list reconciliation scopes matching and rank to media kind, including seasons',async()=>{
  const [list]=await getDb().select().from(lists).where(eq(lists.userId,userId));
  await getDb().insert(listItems).values({listId:list.id,mediaId:extraMovieId,position:3});
  const calls:{path:string;body:Record<string,unknown>}[]=[];
  const adapter=new TraktAdapter(async(path,init)=>{
    if(init?.method==='PUT')return{};
    if(init?.method==='POST'){
      calls.push({path,body:JSON.parse(String(init.body))});
      if(path.endsWith('/reorder'))return {updated:4,skipped_ids:[]};
      return path.endsWith('/remove')?{deleted:{shows:1},not_found:{}}:{added:{movies:2,shows:1,seasons:1},not_found:{}};
    }
    if(path.split('?')[0]===`/users/me/lists/${remoteListId}/items/movie,show,season,episode`)return[
      remoteItems[2],remoteItems[1],remoteItems[0],
      {id:400,type:'show',show:{title:'Unwanted show sharing a wanted movie ID',ids:{trakt:numericId+9}}},
      {id:500,type:'movie',movie:{title:'Wanted movie',ids:{trakt:numericId+9}}},
    ];
    throw new Error(`Unexpected fixture call ${path}`);
  },'fixture-client','fixture-secret');
  await exportTraktListToAdapter(userId,connection.id,{listId:list.id},{adapter,sync,connection});
  expect(calls).toEqual([
    {path:`/users/me/lists/${remoteListId}/items`,body:{movies:[{ids:{trakt:numericId}},{ids:{trakt:numericId+9}}],shows:[{ids:{trakt:numericId}}],seasons:[{ids:{trakt:numericId}}],episodes:[]}},
    {path:`/users/me/lists/${remoteListId}/items/remove`,body:{movies:[],shows:[{ids:{trakt:numericId+9}}],seasons:[],episodes:[]}},
    {path:`/users/me/lists/${remoteListId}/items/reorder`,body:{rank:[300,200,100,500]}},
  ]);
  const members=await getDb().select().from(listItems).where(eq(listItems.listId,list.id)).orderBy(listItems.position);
  expect(members.map(item=>item.mediaId)).toEqual([seasonId,movieId,showId,extraMovieId]);
  await expect(exportTraktListToAdapter(otherId,connection.id,{listId:list.id},{adapter,sync,connection})).rejects.toThrow('does not belong');
  expect(calls).toHaveLength(3);
});


run('an export-only account delivers native history and a private list without importing the remote account',async()=>{
  const db=getDb(),occurredAt='2025-03-08T12:00:00.000Z';
  const [account]=await db.insert(providerConnections).values({userId:otherId,instanceId,externalUserId:crypto.randomUUID(),
    settings:{traktAccess:{import:false,export:true},sync:{...sync,history:true}},
    credentials:await encryptCredential(JSON.stringify({access_token:'synthetic',refresh_token:'synthetic',created_at:Math.floor(Date.now()/1000),expires_in:3600}))}).returning();
  await db.update(providerInstances).set({baseUrl:'https://api.trakt.tv',credentials:await encryptCredential(JSON.stringify({clientId:'synthetic',clientSecret:'synthetic'}))}).where(eq(providerInstances.id,instanceId));
  const writes:{path:string;body:Record<string,unknown>}[]=[];
  const transport=spyOn(network,'createProviderTransport').mockImplementation(config=>async(path,init={})=>{
    await config.beforeDispatch?.();
    const route=path.split('?')[0];
    if(!init.method||init.method==='GET'){
      if(route==='/users/me/watching')return null;
      if(route==='/sync/history'||route===`/sync/history/movies/${numericId}`||route==='/users/me/lists')return [];
      if(route==='/users/me/lists/45/items/movie,show,season,episode')return [remoteItems[1]];
    }else if(init.method==='POST'){
      writes.push({path:route,body:JSON.parse(String(init.body))});
      if(route==='/users/me/lists')return {ids:{trakt:45,slug:'fixture-list'}};
      if(route==='/sync/history'||route==='/users/me/lists/45/items')return {added:{movies:1},not_found:{}};
      if(route==='/users/me/lists/45/items/reorder')return {updated:1,skipped_ids:[]};
    }
    throw new Error(`Unexpected Trakt fixture request ${init.method??'GET'} ${route}`);
  });
  try{
    await trackWithExports(otherId,{mediaId:movieId,action:'watch',occurredAt});
    const list=await createList(otherId,{name:'Exported list',mediaId:movieId});
    const queued=await db.select().from(outboxActions).where(eq(outboxActions.connectionId,account.id));
    expect(queued.map(job=>job.kind).sort()).toEqual(['trakt.export','trakt.list-export']);
    await executeTraktExport(otherId,account.id,queued.find(job=>job.kind==='trakt.export')!.payload);
    await executeTraktListExport(otherId,account.id,{listId:list.id});
    expect(writes.map(row=>row.path)).toEqual(['/sync/history','/users/me/lists','/users/me/lists/45/items','/users/me/lists/45/items/reorder']);
    expect(writes[0].body.movies).toEqual([{ids:{trakt:numericId},watched_at:occurredAt}]);
    expect(writes[1].body.privacy).toBe('private');
    const episode=await ingestMetadata({provider:'trakt',externalId:`${numericId}:episode:1:7`,kind:'episode',title:'Unmapped episode',seasonNumber:1,episodeNumber:7,runtimeMinutes:24},{showId,seasonId});
    mediaIds.push(episode.id);
    await db.update(providerConnections).set({settings:{...account.settings,sync:{...sync,scrobble:true,progress:true}}}).where(eq(providerConnections.id,account.id));
    const sessionId=crypto.randomUUID();
    expect(await executeLiveScrobble(otherId,account.id,{mediaId:episode.id,sessionId,event:'stop',progress:100})).toEqual({skipped:1});
    expect(await executeProgressExport(otherId,account.id,{mediaId:episode.id,progress:50,resolved:true})).toEqual({skipped:1});
    const checkin=await startCheckin(otherId,{workId:episode.id});
    await expect(deliverCheckin(otherId,account.id,checkin.id)).rejects.toThrow('verified Trakt mapping');
    expect(await db.select().from(socialScrobbleDeliveries).where(eq(socialScrobbleDeliveries.sessionId,sessionId))).toHaveLength(0);
    expect(await db.select().from(socialLiveDeliveries).where(eq(socialLiveDeliveries.checkinId,checkin.id))).toHaveLength(0);
    expect(writes).toHaveLength(4);
    expect((await db.select().from(trackingEvents).where(eq(trackingEvents.userId,otherId))).map(event=>event.source)).toEqual(['coast']);
  }finally{transport.mockRestore();}
});

run('staged history follows a verified TMDB episode across numbering differences and a conflicting IMDb alias', async () => {
  const db = getDb();
  const tmdbShow = numericId + 60;
  const tmdbEpisode = numericId + 61;
  const traktEpisode = numericId + 62;
  const imdb = `tt${numericId + 63}`;
  await db.insert(externalIds).values({mediaId:showId,provider:'tmdb',externalId:String(tmdbShow),mediaKind:'show'});
  const single = await ingestMetadata({provider:'tmdb',externalId:String(tmdbEpisode),kind:'episode',title:'Single segment',seasonNumber:1,episodeNumber:5},{showId,seasonId});
  const bundled = await ingestMetadata({provider:'imdb',externalId:imdb,kind:'episode',title:'Two segments',seasonNumber:1,episodeNumber:8},{showId,seasonId});
  mediaIds.push(single.id,bundled.id);
  const episode = { title:'Single segment',season:1,number:8,ids:{trakt:traktEpisode,tmdb:tmdbEpisode,imdb} };
  const series = {...show,ids:{...show.ids,tmdb:tmdbShow}};
  await expect(resolveTrakt({show:{...series,ids:{...series.ids,tmdb:tmdbShow+100}},episode})).rejects.toThrow('Conflicting provider identities');
  const [job] = await db.insert(outboxActions).values({userId,connectionId:connection.id,accountGeneration:connection.accountGeneration,kind:'trakt.import',payload:{},state:'running',attempts:1}).returning();
  const adapter = new TraktAdapter(async path => {
    if(path === '/sync/last_activities')return {all:'2026-11-21T00:00:00Z'};
    if(path.startsWith('/sync/history?'))return [{id:101,watched_at:'1991-08-25T18:22:00Z',show:series,episode}];
    throw new Error(`Unexpected Trakt read: ${path}`);
  },'fixture-client','fixture-secret');
  let outcome: Awaited<ReturnType<typeof importTraktFromAdapter>> | undefined;
  for (let pass = 0; pass < 8 && !outcome; pass++) {
    try {
      outcome = await jobExecution.run({id:job.id,attempts:1,purpose:'manual',started:performance.now(),checkpoints:0},
        () => importTraktFromAdapter(userId,connection.id,{adapter,sync:{history:true,progress:false,collection:false,ratings:false,watchlist:false,lists:false,scrobble:false}}));
    } catch (error) {
      if (!(error instanceof JobYield)) throw error;
    }
  }
  expect(outcome?.imported).toBe(1);
  const mapped = await db.select().from(externalIds).where(inArray(externalIds.externalId,[String(traktEpisode),imdb]));
  expect(mapped.find(row=>row.provider==='trakt')?.mediaId).toBe(single.id);
  expect(mapped.find(row=>row.provider==='imdb')?.mediaId).toBe(bundled.id);
  expect(await db.select({mediaId:trackingEvents.mediaId}).from(trackingEvents)
    .where(and(eq(trackingEvents.userId,userId),inArray(trackingEvents.mediaId,[single.id,bundled.id])))).toEqual([{mediaId:single.id}]);
});
