import {afterAll,beforeAll,expect,test} from 'bun:test';
import {inArray} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {workSocial,activityFeed} from '../src/lib/social/queries.server';
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

run('item Activity replaces friend details while preserving privacy beyond the card head limit',async()=>{
  const read=async(relationship:string)=>(await activityFeed(viewer,{workId:movie,relationship})).items.filter(item=>item.captionActor.username!==`${prefix}-viewer`);
  const users=(items:Awaited<ReturnType<typeof read>>)=>new Set(items.map(item=>item.captionActor.username));
  const all=await read('all');
  expect(all).toHaveLength(6);expect(users(all)).toEqual(new Set(peers.slice(1,7).map((_,i)=>`${prefix}-${i+1}`)));
  expect(await read('consumed')).toHaveLength(6);
  expect(await read('lists')).toEqual([]);
  expect((await activityFeed(viewer,{workId:movie,relationship:'all'})).hasMore).toBe(false);
  const list=crypto.randomUUID(),hiddenList=crypto.randomUUID();
  await getDb().insert(s.lists).values([{id:list,userId:peers[1],name:'Visible list'},{id:hiddenList,userId:peers[0],name:'Private list'}]);
  await getDb().insert(s.listItems).values([{listId:list,mediaId:movie,position:0},{listId:hiddenList,mediaId:movie,position:0}]);
  await getSql()`update users set settings=${{profile:{avatar:'https://private.invalid/avatar'},social:{audience:'friends',sections:{details:'private',ratings:'private'}}}}::jsonb where id=${peers[1]}`;
  await getSql()`update tracking_state set watched=false,play_count=0,position_seconds=120 where user_id=${peers[2]} and media_id=${movie}`;
  await getSql()`update tracking_state set watchlist=true where user_id=${peers[3]} and media_id=${movie}`;
  try{
    const listed=await read('lists');
    expect(listed).toHaveLength(1);expect(listed[0].captionActor).toMatchObject({username:`${prefix}-1`,avatar:null});expect(listed[0].captionSubtitle).not.toContain('4 / 5');
    expect(users(await read('progress'))).toEqual(new Set([`${prefix}-2`]));
    expect(users(await read('watchlist'))).toEqual(new Set([`${prefix}-3`]));
    expect(await read('consumed')).toHaveLength(5);
    expect(await read('favourites')).toHaveLength(6);
    await expect(read('invented')).rejects.toThrow();
  }finally{
    await getDb().delete(s.lists).where(inArray(s.lists.id,[list,hiddenList]));
    await getSql()`update users set settings=${{social:{audience:'friends'}}}::jsonb where id=${peers[1]}`;
    await getSql()`update tracking_state set watched=true,play_count=1,position_seconds=0,watchlist=false where user_id in (${peers[2]},${peers[3]}) and media_id=${movie}`;
  }
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
