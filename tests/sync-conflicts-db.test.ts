import {beforeAll,afterAll,test,expect} from 'bun:test';
import {and,eq,inArray} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {reconcileProviderValue,acknowledgeProviderValue} from '../src/lib/sync/values';
import {getPendingConflicts,repairImportedOrderReviews,refreshConflictStatus} from '../src/lib/sync/conflicts';
import {track} from '../src/lib/core/tracking/service';
import {TraktAdapter} from '../src/lib/providers/trakt/adapter.server';
import {readTraktValue} from '../src/lib/sync/trakt-export';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
let userId:string,connectionId:string,instanceId:string,movieId:string,showId:string,seasonId:string,episodeIds:string[]=[];
const numeric=1_600_000_000+Math.floor(Math.random()*100_000_000);
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getDb();
 const [user]=await db.insert(s.users).values({username:'sync-conflicts-'+crypto.randomUUID()}).returning();userId=user.id;
 const [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:'Conflict fixture',baseUrl:'https://fixture.invalid',enabled:false}).returning();instanceId=instance.id;
 const [connection]=await db.insert(s.providerConnections).values({userId,instanceId,status:'connected'}).returning();connectionId=connection.id;
 const [movie]=await db.insert(s.media).values({kind:'movie',title:'Completed conflict fixture',runtimeMinutes:60}).returning();movieId=movie.id;
 await db.insert(s.externalIds).values({mediaId:movieId,provider:'trakt',externalId:String(numeric),mediaKind:'movie'});
 const [show]=await db.insert(s.media).values({kind:'show',title:'Import order fixture'}).returning();showId=show.id;await db.insert(s.shows).values({mediaId:showId});
 const [season]=await db.insert(s.media).values({kind:'season',title:'Season 1'}).returning();seasonId=season.id;await db.insert(s.seasons).values({mediaId:seasonId,showId,seasonNumber:1});
 for(let number=1;number<=2;number++){
  const [item]=await db.insert(s.media).values({kind:'episode',title:'Episode '+number}).returning();episodeIds.push(item.id);
  await db.insert(s.episodes).values({mediaId:item.id,showId,seasonId,seasonNumber:1,episodeNumber:number});
 }
});
afterAll(async()=>{
 if(!userId)return;const db=getDb();await db.delete(s.users).where(eq(s.users.id,userId));await db.delete(s.providerInstances).where(eq(s.providerInstances.id,instanceId));await db.delete(s.media).where(inArray(s.media.id,[movieId,showId,seasonId,...episodeIds]));
});
run('completed Coast history and a cleared provider resume marker agree without losing completion',async()=>{
 await track(userId,{mediaId:movieId,action:'progress',positionSeconds:3600,durationSeconds:3600});
 await track(userId,{mediaId:movieId,action:'watch'});
 expect(await reconcileProviderValue(userId,connectionId,movieId,'progress',{positionSeconds:0,durationSeconds:3601})).toBe('agree');
 const [state]=await getDb().select().from(s.trackingState).where(and(eq(s.trackingState.userId,userId),eq(s.trackingState.mediaId,movieId)));
 expect(state.watched).toBe(true);expect(state.positionSeconds).toBe(3600);
});
run('obsolete initial-empty flags clear but confirmed remote removals remain conflicts',async()=>{
 const db=getDb();await db.insert(s.syncValues).values({connectionId,mediaId:movieId,category:'history',remote:{value:false},agreed:null,conflict:true});
 await refreshConflictStatus(userId);
 expect(await getPendingConflicts(userId)).toHaveLength(0);
 await db.update(s.syncValues).set({remote:{value:false},agreed:{value:true},conflict:true}).where(and(eq(s.syncValues.connectionId,connectionId),eq(s.syncValues.category,'history')));
 await refreshConflictStatus(userId);
 expect((await getPendingConflicts(userId)).map(row=>row.action)).toContain('history');
 await acknowledgeProviderValue(userId,connectionId,movieId,'history',{value:true});
 expect(await getPendingConflicts(userId)).toHaveLength(0);
});
run('imported episode history needs no order approval while manual out-of-order completion still does',async()=>{
 await expect(track(userId,{mediaId:episodeIds[1],action:'watch',source:'coast'})).rejects.toThrow('Earlier episodes');
 const imported=await track(userId,{mediaId:episodeIds[1],action:'watch',source:'trakt',sourceEventId:'order-fixture',occurredAt:'2026-01-01T12:00:00Z'});
 expect(imported.reviewRequired).toBe(false);expect(imported.state.watched).toBe(true);
 expect((await track(userId,{mediaId:episodeIds[1],action:'watch',source:'trakt',sourceEventId:'order-fixture'})).duplicate).toBe(true);
});
run('Trakt collection lookups find existing entries beyond the first page',async()=>{
 const pages:number[]=[];
 const adapter=new TraktAdapter(async path=>{
  const page=Number(new URL(path,'https://fixture.invalid').searchParams.get('page'));pages.push(page);
  return page===1?Array.from({length:100},(_,i)=>({movie:{title:'Other movie',ids:{trakt:numeric+i+1}}})):[{movie:{title:'Matching movie',ids:{trakt:numeric}}}];
 },'fixture','fixture');
 expect(await readTraktValue(adapter,movieId,'collection')).toEqual({value:true});expect(pages).toEqual([1,2]);
});
run('repairing an obsolete imported order review preserves evidence and dates exactly once',async()=>{
 const db=getDb();
 const [event]=await db.insert(s.trackingEvents).values({userId,mediaId:episodeIds[0],action:'watch',source:'jellyfin',sourceEventId:'old-order-fixture',occurredAt:new Date('2025-01-01T12:00:00Z'),occurredAtKnown:true,applied:false,reviewReason:'Earlier episodes are still unwatched. Mark this episode watched anyway?'}).returning();
 expect(await repairImportedOrderReviews(userId)).toBe(1);expect(await repairImportedOrderReviews(userId)).toBe(0);
 const [evidence]=await db.select().from(s.trackingEvents).where(eq(s.trackingEvents.id,event.id));
 expect(evidence.applied).toBe(false);expect(evidence.reviewDecision).toBe('accepted');
 const [state]=await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId,userId),eq(s.trackingState.mediaId,episodeIds[0])));
 expect(state.playCount).toBe(1);expect(state.lastWatchedAt?.toISOString()).toBe('2025-01-01T12:00:00.000Z');
});
