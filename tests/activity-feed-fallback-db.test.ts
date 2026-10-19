import {expect,test} from 'bun:test';
import {and,eq,inArray} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import {episodes,media,mediaRelationships,seasons,shows,socialActivity,socialReactions,users,works} from '../src/lib/server/db/schema';
import {activityFeed} from '../src/lib/social/queries.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;

run('activity roots retain episode/season precedence and fresh scoped parent fallback',async()=>{
 if(process.env.COAST_AUDIT_REAL_DATA_CLONE==='1')throw Error('Authored correctness setup must not run on the actual-data clone.');
 const db=getDb(),ids:string[]=Array.from({length:8},()=>crypto.randomUUID());
 const [show,otherShow,season,firstEpisode,secondEpisode,movie,parentA,parentB]=ids;let owner:string|undefined;
 try{
  const [user]=await db.insert(users).values({username:`activity-root-${crypto.randomUUID()}`}).returning();owner=user.id;
  await db.insert(media).values(ids.map(id=>({id,kind:[show,otherShow].includes(id)?'show' as const:id===season?'season' as const:[firstEpisode,secondEpisode].includes(id)?'episode' as const:id===movie?'movie' as const:'collection' as const,title:`Activity root ${ids.indexOf(id)}`})));
  await db.insert(shows).values([{mediaId:show},{mediaId:otherShow}]);
  await db.insert(seasons).values({mediaId:season,showId:show,seasonNumber:1});
  await db.insert(episodes).values([firstEpisode,secondEpisode].map((mediaId,index)=>({mediaId,showId:show,seasonId:season,seasonNumber:1,episodeNumber:index+1})));
  await db.insert(mediaRelationships).values([
   {parentId:otherShow,childId:firstEpisode,kind:'contains',position:0},
   {parentId:otherShow,childId:season,kind:'contains',position:0},
   {parentId:parentA,childId:movie,kind:'contains',position:0},
   {parentId:parentB,childId:movie,kind:'contains',position:1},
  ]);
  const events=await db.insert(socialActivity).values([firstEpisode,secondEpisode,season,movie].map((workId,index)=>({userId:user.id,workId,eventKind:'watch',section:'activity',source:'coast',sourceKey:`root:${workId}`,occurredAt:new Date(Date.UTC(2026,8,1,12,index))}))).returning();
  const [episodeEvent,secondEvent,seasonEvent,movieEvent]=events;
  expect((await activityFeed(user.id,{workId:firstEpisode},[episodeEvent.id])).events[0].rootId).toBe(show);
  expect((await activityFeed(user.id,{workId:season},[seasonEvent.id])).events[0].rootId).toBe(show);
  expect((await activityFeed(user.id,{workId:movie},[movieEvent.id])).events[0].rootId).toBe(parentA);
  expect((await activityFeed(user.id,{workId:parentB},[movieEvent.id])).events[0].rootId).toBe(parentB);
  await db.delete(mediaRelationships).where(and(eq(mediaRelationships.parentId,parentA),eq(mediaRelationships.childId,movie),eq(mediaRelationships.kind,'contains')));
  expect((await activityFeed(user.id,{workId:movie},[movieEvent.id])).events[0].rootId).toBe(parentB);
  await db.insert(socialReactions).values({userId:user.id,targetKind:'activity',targetId:secondEvent.id,emoji:'❤️'});
  const feed=await activityFeed(user.id,{workId:show}),group=feed.events.find(event=>event.count===2)!;
  expect(group.rootId).toBe(show);expect(group.members).toEqual([episodeEvent.id,secondEvent.id]);
  const card=feed.items.find(item=>item.entryId===group.id)!;
  expect(card.captionSubtitle).toBe('Watched 2 episodes');expect(card.captionActivity?.myReaction).toBe('❤️');
 }finally{
  if(owner)await db.delete(users).where(eq(users.id,owner));
  await db.delete(media).where(inArray(media.id,ids));await db.delete(works).where(inArray(works.id,ids));
 }
});
