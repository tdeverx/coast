import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq,inArray} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {workCards} from '../src/lib/collection/query.server';
import {activityFeed} from '../src/lib/social/queries.server';
import {mediaViewsForIds} from '../src/lib/server/queries/media';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
let owner:string;
let shows:string[]=[],episodes:string[]=[];
beforeAll(async()=>{
  if(process.env.COAST_DB_TEST!=='1')return;
  const [user]=await getDb().insert(s.users).values({username:`hydration-${crypto.randomUUID()}`}).returning({id:s.users.id});owner=user.id;
  shows=(await getDb().insert(s.media).values(Array.from({length:60},(_,i)=>({kind:'show' as const,title:`Parent ${i}`}))).returning({id:s.media.id})).map(row=>row.id);
  episodes=(await getDb().insert(s.media).values(Array.from({length:60},(_,i)=>({kind:'episode' as const,title:`Episode ${i}`}))).returning({id:s.media.id})).map(row=>row.id);
  await getDb().insert(s.shows).values(shows.map(mediaId=>({mediaId})));
  await getDb().insert(s.episodes).values(episodes.map((mediaId,i)=>({mediaId,showId:shows[i],seasonNumber:1,episodeNumber:1})));
});
afterAll(async()=>{
  if(!owner)return;
  await getDb().delete(s.users).where(eq(s.users.id,owner));
  await getDb().delete(s.media).where(inArray(s.media.id,[...shows,...episodes]));
});
run('shared hydration retains every explicit ID beyond one page and requested entry order',async()=>{
  const requested=[...episodes,...shows,episodes[0]];
  const cards=await workCards(owner,owner,requested);
  expect(cards.map(card=>('workId' in card?card.workId:undefined)??card.id)).toEqual(requested);
  const screen=await mediaViewsForIds(owner,requested);
  expect(screen.map(card=>card.id)).toEqual([...new Set(requested)]);
});
run('a full activity page retains sixty singleton episodes plus sixty distinct show roots',async()=>{
  await getDb().insert(s.socialActivity).values(episodes.map((workId,i)=>({userId:owner,workId,eventKind:'watch',section:'activity',source:'coast',sourceKey:`synthetic:${workId}`,occurredAt:new Date(Date.UTC(2020,0,1,0,i)),dateKnown:true})));
  const feed=await activityFeed(owner);
  expect(feed.items).toHaveLength(60);
  expect(new Set(feed.items.map(item=>item.id))).toEqual(new Set(episodes));
  expect(feed.items.every(item=>/^Parent \d+$/.test(item.captionTitle??''))).toBe(true);
});

run('shared cards transfer only artwork mapping fields and preserve account access',async()=>{
  const [server]=await getDb().insert(s.providerInstances).values({provider:'jellyfin',name:'Projection fixture',baseUrl:'https://fixture.invalid'}).returning({id:s.providerInstances.id});
  const [account]=await getDb().insert(s.providerConnections).values({userId:owner,instanceId:server.id,externalUserId:'fixture'}).returning({id:s.providerConnections.id});
  const [album]=await getDb().insert(s.works).values({category:'music',kind:'album'}).returning({id:s.works.id});
  try{
    await getDb().insert(s.musicWorks).values({id:album.id,kind:'album',title:'Projection album'});
    const items=await getDb().insert(s.providerItems).values([
      {instanceId:server.id,mediaId:album.id,externalId:'album-fixture',kind:'album',snapshot:{primaryImageTag:'primary',unused:'x'.repeat(65536)}},
      {instanceId:server.id,mediaId:episodes[0],externalId:'episode-fixture',kind:'episode',snapshot:{unused:'x'.repeat(65536)}},
    ]).returning();
    await getDb().insert(s.availability).values(items.map(item=>({userId:owner,connectionId:account.id,mediaId:item.mediaId,providerItemId:item.id})));
    const session=(getDb() as unknown as {session:{logger:{logQuery:(query:string,params:unknown[])=>void}}}).session;
    const saved=session.logger,queries:{query:string;params:unknown[]}[]=[];
    let cards:Awaited<ReturnType<typeof workCards>>;
    try{
      session.logger={logQuery:(query,params)=>{if(query.includes('from "provider_items"'))queries.push({query,params});}};
      cards=await workCards(owner,owner,[episodes[0],album.id]);
    }finally{session.logger=saved;}
    expect(cards[1].poster).toBe(`/api/v1/providers/${account.id}/music/album-fixture/artwork`);
    expect(queries.length).toBeGreaterThan(0);
    // Replay only captured SELECTs against this disposable fixture. Assert the actual
    // projection size, not a source-string shape or variable host latency.
    let transferred=0;
    for(const {query,params} of queries){
      const rows=await getSql().unsafe(query,params as never[]);
      transferred+=Buffer.byteLength(JSON.stringify(rows));
    }
    expect(transferred).toBeLessThan(8192);
    await getSql()`update provider_items set snapshot=snapshot-'unused' where instance_id=${server.id}`;
    expect(await workCards(owner,owner,[episodes[0],album.id])).toEqual(cards);
    await getDb().update(s.providerConnections).set({status:'disconnected'}).where(eq(s.providerConnections.id,account.id));
    const disconnected=(await workCards(owner,owner,[album.id]))[0];
    expect(disconnected.poster).toBeUndefined();
    expect('connectionId' in disconnected?disconnected.connectionId:undefined).toBeUndefined();
  }finally{
    await getDb().delete(s.providerInstances).where(eq(s.providerInstances.id,server.id));
    await getDb().delete(s.works).where(eq(s.works.id,album.id));
  }
});

run('parent captions reuse resolved metadata without a second full show hydration',async()=>{
  const {progressData}=await import('../src/lib/server/queries/progress');
  const {publicMedia}=await import('../src/lib/social/public.server');
  await getDb().insert(s.metadataOverrides).values({mediaId:shows[0],title:'Resolved parent title'});
  await getDb().insert(s.trackingState).values({userId:owner,mediaId:episodes[0],positionSeconds:40,durationSeconds:1800});
  const result=await progressData(owner,{view:'watching',scope:'all'});
  expect(result.items.find(item=>item.id===episodes[0])?.captionTitle).toBe('Resolved parent title');
  expect((await mediaViewsForIds(owner,[episodes[0]]))[0].showTitle).toBe('Resolved parent title');
  // Guests retain the public/raw metadata policy rather than private overrides.
  expect((await publicMedia([episodes[0]]))[0].showTitle).toBe('Parent 0');
});
