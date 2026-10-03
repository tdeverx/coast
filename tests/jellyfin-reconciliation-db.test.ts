import {beforeAll,afterAll,expect,test} from 'bun:test';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import {syncJellyfinUser,executeJellyfinUserState,type JellyfinSyncContext} from '../src/lib/sync/jellyfin';
import {persistMusic,logMusic} from '../src/lib/music/persistence.server';
import {workAssessments} from '../src/lib/collection/query.server';
import {trackWithExports} from '../src/lib/sync/changes';
const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const tag=crypto.randomUUID(),albumExternal='a'.repeat(32),trackExternal='b'.repeat(32);
const remote={Played:false,PlayCount:0,PlaybackPositionTicks:0,IsFavorite:false};
const writes:Record<string,unknown>[]=[];
let screenCopies:Record<string,unknown>[]=[];
let screenPageSize=1;
let failure=false,userId:string,trackId:string,albumId:string,connection:typeof s.providerConnections.$inferSelect,instance:typeof s.providerInstances.$inferSelect,oldConfig:Record<string,unknown>|null=null;
const album={Id:albumExternal,Type:'MusicAlbum',Name:'Reconciliation album',ChildCount:1,ProviderIds:{MusicBrainzReleaseGroup:crypto.randomUUID()}};
const track={Id:trackExternal,Type:'Audio',Name:'Reconciliation track',AlbumId:albumExternal,IndexNumber:1,RunTimeTicks:120000000,ProviderIds:{MusicBrainzTrack:crypto.randomUUID()},UserData:remote};
const adapter=new JellyfinAdapter(async(path,init)=>{
 const url=new URL(path,'https://fixture.invalid');
 if(url.pathname==='/System/Info/Public')return {Id:tag,ServerName:'Fixture',ProductName:'Jellyfin Server',Version:'10.11.0'};
 if(url.pathname==='/Items'){
  if(failure)throw new Error('Interrupted first page');
  const type=url.searchParams.get('includeItemTypes')??'';
  const items=type==='MusicAlbum'?[album]:type==='Audio'?[track]:screenCopies;
  const offset=Number(url.searchParams.get('startIndex')??0);
  return {Items:items===screenCopies?items.slice(offset,offset+screenPageSize):items,TotalRecordCount:items.length,StartIndex:offset};
 }
 if(url.pathname===`/Users/${tag}/Items/${trackExternal}`)return track;
 if(url.pathname.startsWith('/UserItems/')){const body=JSON.parse(String(init?.body));writes.push(body);Object.assign(remote,body);return remote;}
 if(url.pathname.startsWith('/UserFavoriteItems/')){remote.IsFavorite=init?.method==='POST';writes.push({IsFavorite:remote.IsFavorite});return remote;}
 throw new Error(`Unexpected fixture request ${path}`);
},tag,'synthetic');
const context=():JellyfinSyncContext=>({adapter,connection,instance});
async function settings(patch:Record<string,unknown>){[connection]=await getDb().update(s.providerConnections).set({settings:patch}).where(eq(s.providerConnections.id,connection.id)).returning();}
beforeAll(async()=>{
 if(!enabled)return;const db=getDb();
 const [config]=await db.select().from(s.systemSettings).where(eq(s.systemSettings.key,'coast'));oldConfig=(config?.value as Record<string,unknown>)??null;
 await db.insert(s.systemSettings).values({key:'coast',value:{...oldConfig,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...oldConfig,experimentalMusic:true,experimentalGaming:true,experimentalParties:true}}});
 const [user]=await db.insert(s.users).values({username:`music-reconcile-${tag}`}).returning();userId=user.id;
 [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid',serverIdentity:tag}).returning();
 [connection]=await db.insert(s.providerConnections).values({userId,instanceId:instance.id,externalUserId:tag,settings:{importPlayback:false,reconcileTracking:true}}).returning();
 // Local metadata and listening history exist before this account has any access mapping.
 const savedAlbum=await persistMusic(instance.id,{id:albumExternal,kind:'album',title:album.Name,artists:[],albumArtists:[],artistNames:[],genres:[],externalIds:{musicbrainzreleasegroup:album.ProviderIds.MusicBrainzReleaseGroup}});albumId=savedAlbum.workId!;
 const saved=await persistMusic(instance.id,{id:trackExternal,kind:'track',title:track.Name,albumId:albumExternal,artists:[],albumArtists:[],artistNames:[],genres:[],externalIds:{musicbrainztrack:track.ProviderIds.MusicBrainzTrack}});trackId=saved.workId!;
 await logMusic(userId,trackId,{batchId:crypto.randomUUID()});await logMusic(userId,trackId,{batchId:crypto.randomUUID()});
 await trackWithExports(userId,{mediaId:trackId,action:'favourite',value:true});
});
afterAll(async()=>{if(!enabled||!userId)return;const db=getDb();await db.delete(s.users).where(eq(s.users.id,userId));await db.delete(s.providerInstances).where(eq(s.providerInstances.id,instance.id));await db.delete(s.works).where(inArray(s.works.id,[trackId,albumId]));if(oldConfig)await db.update(s.systemSettings).set({value:oldConfig}).where(eq(s.systemSettings.key,'coast'));else await db.delete(s.systemSettings).where(eq(s.systemSettings.key,'coast'));});
run('late mappings deliver retained music intent independently of import opt-out, without dated remote events',async()=>{
 const db=getDb();expect(await db.select().from(s.availability).where(eq(s.availability.connectionId,connection.id))).toHaveLength(0);
 expect((await db.select().from(s.reconciliationIntents).where(eq(s.reconciliationIntents.connectionId,connection.id))).length).toBeGreaterThan(0);
 await syncJellyfinUser(userId,connection.id,undefined,context());expect(writes).toHaveLength(0);
 const actions=await db.select().from(s.outboxActions).where(and(eq(s.outboxActions.connectionId,connection.id),eq(s.outboxActions.kind,'jellyfin.reconcile')));
 for(const action of actions)await executeJellyfinUserState(userId,connection.id,action.payload,context());
 expect(remote.PlayCount).toBe(2);expect(remote.IsFavorite).toBe(true);expect(writes.some(w=>'LastPlayedDate' in w)).toBe(false);
 expect(await db.select().from(s.reconciliationIntents).where(eq(s.reconciliationIntents.connectionId,connection.id))).toHaveLength(0);
 expect((await db.select().from(s.musicListens).where(eq(s.musicListens.userId,userId)))).toHaveLength(2);
});
run('resuming a traversal preserves its original observation watermark',async()=>{
 const scanId=crypto.randomUUID(),startedAt=new Date(Date.now()-120000).toISOString(),db=getDb();
 await db.update(s.syncCheckpoints).set({cursor:'0',scanId}).where(and(eq(s.syncCheckpoints.connectionId,connection.id),eq(s.syncCheckpoints.kind,'jellyfin-user')));
 await settings({...connection.settings,userSync:{scanId,startedAt,processed:0,total:null,phase:'scanning'}});
 await syncJellyfinUser(userId,connection.id,undefined,context());
 const [checkpoint]=await db.select().from(s.syncCheckpoints).where(and(eq(s.syncCheckpoints.connectionId,connection.id),eq(s.syncCheckpoints.kind,'jellyfin-user')));
 expect(checkpoint.completedAt?.toISOString()).toBe(startedAt);expect(checkpoint.scanId).toBeNull();
});
run('acknowledged listening counts do not reimport Coast plays; new remote counts import once and remain undated',async()=>{
 await settings({importPlayback:true,reconcileTracking:true});await syncJellyfinUser(userId,connection.id,undefined,context());
 expect(await getDb().select().from(s.musicListens).where(eq(s.musicListens.userId,userId))).toHaveLength(2);
 remote.PlayCount=3;await syncJellyfinUser(userId,connection.id,undefined,context());await syncJellyfinUser(userId,connection.id,undefined,context());
 const rows=await getDb().select().from(s.musicListens).where(eq(s.musicListens.userId,userId));expect(rows).toHaveLength(3);expect(rows.filter(r=>r.source==='jellyfin')[0].occurredAtKnown).toBe(false);
});
run('fractional music progress uses consistent baselines and delivers without changing listen counts',async()=>{
 await settings({importPlayback:false,reconcileTracking:true});
 await getDb().update(s.musicProgress).set({positionSeconds:1.125,durationSeconds:12.045}).where(and(eq(s.musicProgress.userId,userId),eq(s.musicProgress.trackId,trackId)));
 await executeJellyfinUserState(userId,connection.id,{mediaId:trackId,field:'progress',value:1.125,durationSeconds:12.045,backfill:true},context());
 expect(remote.PlaybackPositionTicks).toBe(11250000);expect(remote.PlayCount).toBe(3);
});
run('nonempty divergent music state requires Manual review, and disabling reconciliation prevents queued backfill',async()=>{
 const db=getDb();await settings({importPlayback:false,reconcileTracking:true});await logMusic(userId,trackId,{batchId:crypto.randomUUID()});
 const before=writes.length;await executeJellyfinUserState(userId,connection.id,{mediaId:trackId,field:'watched',value:true,playCount:4,backfill:true},context());
 const [value]=await db.select().from(s.syncValues).where(and(eq(s.syncValues.connectionId,connection.id),eq(s.syncValues.mediaId,trackId),eq(s.syncValues.category,'history')));
 // Remote divergence since the agreed baseline, rather than ordinary local advancement.
 remote.PlayCount=8;await executeJellyfinUserState(userId,connection.id,{mediaId:trackId,field:'watched',value:true,playCount:4,backfill:true},context());
 const [conflict]=await db.select().from(s.syncValues).where(eq(s.syncValues.id,value.id));expect(conflict.conflict).toBe(true);
 const after=writes.length;expect(after).toBeGreaterThanOrEqual(before);
 await settings({importPlayback:false,reconcileTracking:false});remote.PlayCount=0;await executeJellyfinUserState(userId,connection.id,{mediaId:trackId,field:'watched',value:true,playCount:4,backfill:true},context());expect(writes).toHaveLength(after);
});
run('an interrupted first page invalidates old negative coverage and never removes positive observations',async()=>{
 const db=getDb();const [missing]=await db.insert(s.media).values({kind:'movie',title:`missing-${tag}`}).returning();
 try{const [before]=await workAssessments(userId,userId,[missing.id]);expect(before.availability).toBe('unavailable');failure=true;
  await expect(syncJellyfinUser(userId,connection.id,undefined,context())).rejects.toThrow('Interrupted first page');
  const [after]=await workAssessments(userId,userId,[missing.id]);expect(after.availability).toBe('unknown');const [positive]=await workAssessments(userId,userId,[trackId]);expect(positive.availability).toBe('available');expect(positive.stale).toBe(true);
  expect((await db.execute(sql`select scan_id from sync_checkpoints where connection_id=${connection.id} and kind='jellyfin-user'`))[0].scan_id).not.toBeNull();
 }finally{failure=false;await db.delete(s.media).where(eq(s.media.id,missing.id));}
});
run('an explicit mapped music favourite can fill an empty server field with imports and automatic reconciliation both disabled',async()=>{
 await settings({importPlayback:false,reconcileTracking:false});const db=getDb();
 await trackWithExports(userId,{mediaId:trackId,action:'favourite',value:false});
 await db.delete(s.syncValues).where(and(eq(s.syncValues.connectionId,connection.id),eq(s.syncValues.mediaId,trackId),eq(s.syncValues.category,'favourite')));
 remote.IsFavorite=false;await trackWithExports(userId,{mediaId:trackId,action:'favourite',value:true});
 await executeJellyfinUserState(userId,connection.id,{mediaId:trackId,field:'favourite',value:true,backfill:false},context());
 expect(remote.IsFavorite).toBe(true);expect(connection.settings.importPlayback).toBe(false);expect(connection.settings.reconcileTracking).toBe(false);
});

run('duplicate accessible copies reconcile once after a complete, paginated user traversal',async()=>{
 const db=getDb(),movie=crypto.randomUUID(),external=['c'.repeat(32),'d'.repeat(32)];
 await db.insert(s.media).values({id:movie,kind:'movie',title:'Two editions'});await db.insert(s.movies).values({mediaId:movie});
 for(const id of external)await db.insert(s.providerItems).values({instanceId:instance.id,mediaId:movie,externalId:id,kind:'movie'});
 screenCopies=external.map((Id,index)=>({Id,Type:'Movie',Name:'Two editions',RunTimeTicks:1200000000,UserData:{Played:index===1,IsFavorite:index===1,PlayCount:index,PlaybackPositionTicks:0,...(index===1?{LastPlayedDate:'2025-01-01T00:00:00Z'}:{})}}));
 try{
  await settings({importPlayback:true,reconcileTracking:false});
  await syncJellyfinUser(userId,connection.id,undefined,context());await syncJellyfinUser(userId,connection.id,undefined,context());
  const events=await db.select().from(s.trackingEvents).where(and(eq(s.trackingEvents.userId,userId),eq(s.trackingEvents.mediaId,movie),eq(s.trackingEvents.action,'watch')));
  expect(events).toHaveLength(1);expect((await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId,userId),eq(s.trackingState.mediaId,movie))))[0].watched).toBe(true);
  expect((await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId,userId),eq(s.trackingState.mediaId,movie))))[0].favourite).toBe(true);
  screenCopies.forEach(item=>Object.assign(item.UserData as object,{Played:false,IsFavorite:false}));
  await syncJellyfinUser(userId,connection.id,undefined,context());
  expect((await db.select().from(s.trackingState).where(and(eq(s.trackingState.userId,userId),eq(s.trackingState.mediaId,movie))))[0].watched).toBe(false);
 }finally{screenCopies=[];await db.delete(s.media).where(eq(s.media.id,movie));await db.delete(s.works).where(eq(s.works.id,movie));}
});

run('screen reconciliation crosses its 100-title boundary without skipping or repeating history',async()=>{
 const db=getDb(),titles=Array.from({length:101},(_,index)=>({id:crypto.randomUUID(),kind:'movie' as const,title:`Paged observation ${index}`}));
 await db.insert(s.media).values(titles);await db.insert(s.movies).values(titles.map(title=>({mediaId:title.id})));
 const copies=titles.map(title=>({externalId:crypto.randomUUID().replaceAll('-',''),mediaId:title.id}));
 copies.push({externalId:crypto.randomUUID().replaceAll('-',''),mediaId:titles[100].id});
 await db.insert(s.providerItems).values(copies.map(copy=>({...copy,instanceId:instance.id,kind:'movie' as const})));
 screenCopies=copies.map(copy=>({Id:copy.externalId,Type:'Movie',Name:'Paged observation',UserData:{Played:true,IsFavorite:false,PlayCount:1,PlaybackPositionTicks:0,LastPlayedDate:'2025-01-01T00:00:00Z'}}));
 screenPageSize=100;
 try{
  await settings({importPlayback:true,reconcileTracking:false});
  await syncJellyfinUser(userId,connection.id,undefined,context());
  await syncJellyfinUser(userId,connection.id,undefined,context());
  const events=await db.select().from(s.trackingEvents).where(and(eq(s.trackingEvents.userId,userId),inArray(s.trackingEvents.mediaId,titles.map(title=>title.id)),eq(s.trackingEvents.action,'watch')));
  expect(events).toHaveLength(101);expect(new Set(events.map(event=>event.mediaId)).size).toBe(101);
 }finally{
  screenCopies=[];screenPageSize=1;
  await db.delete(s.media).where(inArray(s.media.id,titles.map(title=>title.id)));
  await db.delete(s.works).where(inArray(s.works.id,titles.map(title=>title.id)));
 }
});
