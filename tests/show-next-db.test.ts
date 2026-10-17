import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import { showNext } from '../src/lib/server/queries/show-next';
import { PAGE_SIZE } from '../src/lib/server/queries/pagination';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const viewer = crypto.randomUUID(), other = crypto.randomUUID();
const ids: string[] = [];
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getDb().insert(s.users).values([viewer, other].map(id => ({ id, username: `up-next-${id}` })));
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  if (ids.length) await getDb().delete(s.works).where(inArray(s.works.id, ids));
  await getDb().delete(s.users).where(inArray(s.users.id, [viewer, other]));
});
async function fixture(count: number) {
  const db = getDb();
  const [show] = await db.insert(s.media).values({kind:'show',title:'Up next fixture'}).returning();
  ids.push(show.id);
  await db.insert(s.shows).values({mediaId:show.id});
  const episodes = await db.insert(s.media).values(Array.from({length:count},(_,i)=>({
    kind:'episode' as const,title:`Episode ${i+1}`,releaseDate:'2000-01-01',runtimeMinutes:45,
  }))).returning();
  ids.push(...episodes.map(episode=>episode.id));
  await db.insert(s.episodes).values(episodes.map((episode,i)=>({
    mediaId:episode.id,showId:show.id,seasonNumber:Math.floor(i/3)+1,episodeNumber:i%3+1,
  })));
  return {show:show.id,episodes:episodes.map(episode=>episode.id)};
}

run('air-date order retains all seasons while the next resume target is independent of availability',async()=>{
  const {show,episodes}=await fixture(7),db=getDb();
  await db.insert(s.trackingState).values([
    {userId:viewer,mediaId:episodes[0],watched:true,lastWatchedAt:new Date()},
    {userId:viewer,mediaId:episodes[2],positionSeconds:120,durationSeconds:2700},
    {userId:viewer,mediaId:episodes[5],dropped:true},
    {userId:other,mediaId:episodes[1],watched:true},
  ]);
  await db.update(s.media).set({releaseDate:'2999-01-01'}).where(eq(s.media.id,episodes[4]));
  await db.update(s.episodes).set({isSpecial:true}).where(eq(s.episodes.mediaId,episodes[6]));
  const regular=await showNext(viewer,show);
  expect(regular.items.map(item=>item.id)).toEqual([episodes[0],episodes[1],episodes[2],episodes[3],episodes[5],episodes[4]]);
  expect(regular.total).toBe(6);
  expect(regular.focusId).toBe(episodes[2]);
  const result=await showNext(viewer,show,undefined,false,true);
  expect(result.items.map(item=>item.id)).toEqual([episodes[0],episodes[1],episodes[2],episodes[3],episodes[5],episodes[6],episodes[4]]);
  expect(result.focusId).toBe(episodes[2]);
  expect(result.items[2]).toMatchObject({progress:120,available:false,runtimeMinutes:45,releaseDate:'2000-01-01'});
  expect(result).toMatchObject({page:1,pages:1,total:7});
  // Finishing the current episode promotes the remaining gap, not a later season.
  await db.update(s.trackingState).set({watched:true,positionSeconds:0,lastWatchedAt:new Date()})
    .where(eq(s.trackingState.mediaId,episodes[2]));
  expect((await showNext(viewer,show)).focusId).toBe(episodes[1]);
});

run('specials are excluded before pagination and do not replace the regular next episode when shown',async()=>{
  const {show,episodes}=await fixture(PAGE_SIZE+1),db=getDb();
  await db.update(s.episodes).set({isSpecial:true}).where(eq(s.episodes.mediaId,episodes[0]));
  await db.insert(s.trackingState).values({userId:viewer,mediaId:episodes[0],positionSeconds:120,durationSeconds:2700});
  const regular=await showNext(viewer,show);
  expect(regular).toMatchObject({total:PAGE_SIZE,page:1,pages:1,focusId:episodes[1]});
  expect(regular.items.map(item=>item.id)).toEqual(episodes.slice(1));
  const all=await showNext(viewer,show,undefined,false,true);
  expect(all).toMatchObject({total:PAGE_SIZE+1,page:1,pages:2,focusId:episodes[1]});
  expect(all.items.map(item=>item.id)).toEqual(episodes.slice(0,PAGE_SIZE));
});

run('completed episodes stay accessible and an explicit rewatch starts at episode one',async()=>{
  const {show,episodes}=await fixture(3),db=getDb(),boundary=new Date('2026-01-01T00:00:00Z');
  await db.insert(s.trackingState).values(episodes.map(mediaId=>({userId:viewer,mediaId,watched:true,lastWatchedAt:new Date('2025-01-01T00:00:00Z')})));
  const completed=await showNext(viewer,show);
  expect(completed.items.map(item=>item.id)).toEqual(episodes);
  expect(completed.focusId).toBeUndefined();
  await db.insert(s.rewatches).values({userId:viewer,mediaId:show,startedAt:boundary});
  const result=await showNext(viewer,show);
  expect(result.items.map(item=>item.id)).toEqual(episodes);
  expect(result.items.every(item=>!item.watched)).toBe(true);
  expect(result.focusId).toBe(episodes[0]);
  expect((await db.select().from(s.trackingState).where(eq(s.trackingState.userId,viewer))).filter(row=>episodes.includes(row.mediaId)).every(row=>row.watched)).toBe(true);
});

run('long shows use bounded, ordered pages and validate show identity and feature policy',async()=>{
  const {show,episodes}=await fixture(PAGE_SIZE+2);
  const first=await showNext(viewer,show),second=await showNext(viewer,show,2);
  expect(first.items.map(item=>item.id)).toEqual(episodes.slice(0,PAGE_SIZE));
  expect(second.items.map(item=>item.id)).toEqual(episodes.slice(PAGE_SIZE));
  expect(first).toMatchObject({page:1,pages:2,total:PAGE_SIZE+2});
  expect((await showNext(viewer,show,999)).page).toBe(2);
  await getDb().insert(s.trackingState).values(episodes.slice(0,PAGE_SIZE+1).map(mediaId=>({userId:viewer,mediaId,watched:true,lastWatchedAt:new Date()})));
  const anchored=await showNext(viewer,show);
  expect(anchored.page).toBe(2);
  expect(anchored.focusId).toBe(episodes[PAGE_SIZE+1]);
  expect(anchored.items.map(item=>item.id)).toEqual(episodes.slice(PAGE_SIZE));
  expect((await showNext(viewer,show,1)).items.map(item=>item.id)).toEqual(episodes.slice(0,PAGE_SIZE));
  await expect(showNext(viewer,episodes[0])).rejects.toMatchObject({status:404});
  await expect(showNext(viewer,show,0)).rejects.toThrow();
  await expect(showNext(crypto.randomUUID(),show)).rejects.toMatchObject({code:'feature_disabled'});
});

run('air dates override season numbering, with undated episodes last and stable tie breaks',async()=>{
  const {show,episodes}=await fixture(4),db=getDb();
  await db.update(s.media).set({releaseDate:'1999-01-01'}).where(eq(s.media.id,episodes[3]));
  await db.update(s.media).set({releaseDate:null}).where(eq(s.media.id,episodes[1]));
  expect((await showNext(viewer,show)).items.map(item=>item.id)).toEqual([episodes[3],episodes[0],episodes[2],episodes[1]]);
});

run('Available scopes both the episode sequence and its anchor to the viewer’s connected sources',async()=>{
  const {show,episodes}=await fixture(4),db=getDb(),instanceId=crypto.randomUUID(),connectionId=crypto.randomUUID();
  await db.insert(s.providerInstances).values({id:instanceId,provider:'jellyfin',name:'Next availability',baseUrl:'https://fixture.invalid'});
  try{
    await db.insert(s.providerConnections).values({id:connectionId,instanceId,userId:viewer});
    const items=await db.insert(s.providerItems).values(episodes.slice(1).map(mediaId=>({instanceId,mediaId,kind:'episode' as const,externalId:mediaId}))).returning();
    await db.insert(s.availability).values(items.map(item=>({userId:viewer,connectionId,mediaId:item.mediaId!,providerItemId:item.id})));
    await db.insert(s.trackingState).values({userId:viewer,mediaId:episodes[1],watched:true,lastWatchedAt:new Date()});
    const result=await showNext(viewer,show,undefined,true);
    expect(result.items.map(item=>item.id)).toEqual(episodes.slice(1));
    expect(result.focusId).toBe(episodes[2]);expect(result.items.every(item=>item.available)).toBe(true);
    expect((await showNext(other,show,undefined,true)).items).toEqual([]);
    await db.update(s.providerConnections).set({status:'disconnected'}).where(eq(s.providerConnections.id,connectionId));
    expect((await showNext(viewer,show,undefined,true)).items).toEqual([]);
  }finally{await db.delete(s.providerInstances).where(eq(s.providerInstances.id,instanceId));}
});
