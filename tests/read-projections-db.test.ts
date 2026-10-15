import {afterAll,beforeAll,expect,test} from 'bun:test';
import {inArray} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {workSocial} from '../src/lib/social/queries.server';
import {publicDetails,publicMedia} from '../src/lib/social/public.server';
import {profileData,profileActivity,profileInsightsData} from '../src/lib/server/queries/profile';
import {sequenceEntries,nextSequenceEntry} from '../src/lib/core/lists/sequence.server';
import {sequenceNextView} from '../src/lib/server/queries/media';
const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const viewer=crypto.randomUUID(),peers=Array.from({length:8},()=>crypto.randomUUID());
const [movie,empty,collection,show]=Array.from({length:4},()=>crypto.randomUUID());
const seasons=Array.from({length:501},()=>crypto.randomUUID()),episodes=Array.from({length:501},()=>crypto.randomUUID());
const prefix=`projection-${crypto.randomUUID()}`;
const mediaIds=[movie,empty,collection,show,...seasons,...episodes];
beforeAll(async()=>{
  if(!enabled)return;
  const db=getDb();
  await db.insert(s.users).values([
    {id:viewer,username:`${prefix}-viewer`,settings:{profile:{backgroundMode:'fixed'},social:{audience:'public'}}},
    ...peers.map((id,i)=>({id,username:`${prefix}-${i}`,disabled:i===7,settings:{social:{audience:i===0?'private' as const:'friends' as const}}})),
  ]);
  await db.insert(s.media).values([
    {id:movie,kind:'movie',title:'Projected movie',posterPath:'https://private.invalid/never-public.jpg'},
    {id:empty,kind:'movie',title:'No matching friends'},
    {id:collection,kind:'collection',title:'Next collection'},
    {id:show,kind:'show',title:'Complete guest hierarchy'},
    ...seasons.map((id,i)=>({id,kind:'season' as const,title:`Season ${i}`})),
    ...episodes.map((id,i)=>({id,kind:'episode' as const,title:`Episode ${i}`})),
  ]);
  await db.insert(s.shows).values({mediaId:show});
  await db.insert(s.seasons).values(seasons.map((mediaId,i)=>({mediaId,showId:show,seasonNumber:i+1})));
  await db.insert(s.episodes).values(episodes.map((mediaId,i)=>({mediaId,showId:show,seasonId:seasons[0],seasonNumber:1,episodeNumber:i+1})));
  await db.insert(s.friendships).values(peers.map(id=>({userA:[id,viewer].sort()[0],userB:[id,viewer].sort()[1],requestedBy:viewer,state:'accepted' as const})));
  await db.insert(s.trackingState).values([
    {userId:viewer,mediaId:movie,favourite:true,watched:true,playCount:1},
    ...peers.map(userId=>({userId,mediaId:movie,collected:true,favourite:true,watched:true,playCount:1})),
  ]);
  await db.insert(s.ratings).values(peers.map(userId=>({userId,mediaId:movie,value:4})));
  await db.insert(s.mediaRelationships).values([
    {parentId:collection,childId:movie,kind:'collection',position:0},
    {parentId:collection,childId:empty,kind:'collection',position:1},
  ]);
});
afterAll(async()=>{
  if(!enabled)return;
  await getDb().delete(s.users).where(inArray(s.users.id,[viewer,...peers]));
  await getDb().delete(s.works).where(inArray(s.works.id,mediaIds));
});

run('social SQL bounds detail rows after privacy while retaining exact counts and order',async()=>{
  const session=(getDb() as unknown as {session:{logger:{logQuery:(query:string,params:unknown[])=>void}}}).session;
  const saved=session.logger,queries:{query:string;params:unknown[]}[]=[];
  let result:Awaited<ReturnType<typeof workSocial>>;
  try{
    session.logger={logQuery:(query,params)=>queries.push({query,params})};
    result=await workSocial(viewer,[movie,empty]);
  }finally{session.logger=saved;}
  expect(result[movie].total).toBe(6); // Private and disabled users never occupy a rank.
  expect(result[movie].friends.map(friend=>friend.userId)).toEqual(peers.slice(1,4));
  expect(result[empty]).toEqual({friends:[],total:0,reactions:[]});
  const projected=await getSql().unsafe(queries[0].query,queries[0].params as never[]);
  expect(projected).toHaveLength(3);expect(projected.every((row:{total:number})=>row.total===6)).toBe(true);
  await getSql()`update friendships set state='removed' where (user_a=${viewer} or user_b=${viewer}) and (user_a=${peers[1]} or user_b=${peers[1]})`;
  try{
    const removed=await workSocial(viewer,[movie]);
    expect(removed[movie].total).toBe(5);expect(removed[movie].friends.map(friend=>friend.userId)).toEqual(peers.slice(2,5));
  }finally{await getSql()`update friendships set state='accepted' where (user_a=${viewer} or user_b=${viewer}) and (user_a=${peers[1]} or user_b=${peers[1]})`;}
});

run('guest detail membership exceeds 500 without losing seasons, episodes or public-safe state',async()=>{
  const data=await publicDetails(show);
  expect(data.seasons.map(season=>season.mediaId)).toEqual(seasons);
  expect(new Set(data.episodes.map(episode=>episode.id))).toEqual(new Set(episodes));
  expect(data.seasons.every(season=>season.item?.title)).toBe(true);
  const selected=await publicMedia([...episodes.toReversed(),movie,episodes[0]]);
  expect(selected.map(card=>card.id)).toEqual([...episodes.toReversed(),movie]);
  expect(selected.find(card=>card.id===movie)?.poster).toBeNull();
  expect(selected.every(card=>!card.available&&!card.favourite&&!card.watched&&card.rating===null)).toBe(true);
  expect(data.availability).toEqual([]);expect(data.history).toEqual([]);
});

run('insight projection retains full-profile totals and activity across periods and viewer audiences',async()=>{
  const now=new Date('2026-10-15T12:00:00Z');
  for(const viewerId of [viewer,peers[1],null])for(const period of ['all','year','month'] as const){
    const full=await profileData(viewer,{period},now,viewerId);
    expect(await profileInsightsData(viewer,{period},now,viewerId)).toEqual({totals:full.totals,activity:await profileActivity(viewer,now,period,viewerId)});
  }
  await getSql()`update users set settings=${{social:{audience:'private'}}}::jsonb where id=${viewer}`;
  try{await expect(profileInsightsData(viewer,{},now,null)).rejects.toMatchObject({status:404});}
  finally{await getSql()`update users set settings=${{profile:{backgroundMode:'fixed'},social:{audience:'public'}}}::jsonb where id=${viewer}`;}
});

run('ordinary sequence-next returns the same selected entry while transferring only one entry row',async()=>{
  const source={kind:'collection' as const,id:collection};
  const expected=nextSequenceEntry(await sequenceEntries(viewer,source));
  const session=(getDb() as unknown as {session:{logger:{logQuery:(query:string,params:unknown[])=>void}}}).session;
  const saved=session.logger,queries:{query:string;params:unknown[]}[]=[];
  let result:Awaited<ReturnType<typeof sequenceNextView>>;
  try{
    session.logger={logQuery:(query,params)=>queries.push({query,params})};
    result=await sequenceNextView(viewer,source);
  }finally{session.logger=saved;}
  expect(result?.id).toBe(expected?.mediaId);expect(result?.sequence).toEqual({...source,entryId:expected!.entryId});
  // The second query is the selected-entry projection after source validation.
  const entries=await getSql().unsafe(queries[1].query,queries[1].params as never[]);
  expect(entries).toHaveLength(1);expect(entries[0].mediaId).toBe(expected?.mediaId);
});
