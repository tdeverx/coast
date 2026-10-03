import {beforeAll,beforeEach,afterAll,expect,test} from 'bun:test';
import {and,eq,inArray} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {ingestMetadata} from '../src/lib/catalogue/service';
import {TraktAdapter} from '../src/lib/providers/trakt/adapter.server';
import {previewProjection,approveProjection,executeProjection,reviewProjection,executeProjectionReview,readProjectionRemote,desiredProjection,isGeneratedProjection,type ProjectionContext} from '../src/lib/collection/projection.server';
import {previewSourceChange,validateSourceChange,markSourceChange} from '../src/lib/collection/source-changes.server';
import {importTraktFromAdapter} from '../src/lib/sync/trakt-import';
const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const tag=crypto.randomUUID(),base=1_000_000_000+Math.floor(Math.random()*100_000_000);
let userId:string,instanceId:string,connection:typeof s.providerConnections.$inferSelect,sourceId:string,sourceInstance:string;
const movieIds:string[]=[],showIds:string[]=[],episodeIds:string[]=[],allIds:string[]=[];
const remote=new Map<number,{title:string;ids:{trakt:number};collected_at:string;metadata?:Record<string,unknown>}>();
let showPages=false,lostResponse=false,writes:{remove:boolean;id:number}[]=[];
const paths:string[]=[];
const adapter=new TraktAdapter(async(path,init)=>{
 paths.push(path);const url=new URL(path,'https://fixture.invalid');
 if(url.pathname==='/users/settings')return {user:{username:'fixture',ids:{uuid:connection.externalUserId}}};
 if(url.pathname==='/sync/collection/movies'){
  const page=Number(url.searchParams.get('page')??1);return [...remote.entries()].slice((page-1)*100,page*100).map(([,m])=>({movie:{title:m.title,ids:m.ids},collected_at:m.collected_at,metadata:m.metadata}));
 }
 if(url.pathname==='/sync/collection/shows'){
  if(!showPages)return[];const page=Number(url.searchParams.get('page')??1);
  return showIds.slice((page-1)*100,page*100).map((_,i)=>({show:{title:`Show ${i}`,ids:{trakt:base+200+(page-1)*100+i}},seasons:[{number:1,episodes:[{number:1,collected_at:'2020-01-01T00:00:00.000Z'}]}]}));
 }
 if(url.pathname==='/sync/collection'||url.pathname==='/sync/collection/remove'){
  const body=JSON.parse(String(init?.body)),remove=url.pathname.endsWith('/remove');
  for(const movie of body.movies??[]){const id=Number(movie.ids.trakt);writes.push({remove,id});if(remove)remote.delete(id);else remote.set(id,{title:`Movie ${id-base}`,ids:{trakt:id},collected_at:movie.collected_at??'2020-01-01T00:00:00.000Z'});}
  if(lostResponse){lostResponse=false;throw new Error('Delivery response lost');}return {};
 }
 throw new Error(`Unexpected fixture call ${path}`);
},'fixture','fixture');
const context=():ProjectionContext=>({connection,adapter});
const config=(extra:Partial<Parameters<typeof desiredProjection>[1]>={}):Parameters<typeof desiredProjection>[1]=>({enabled:true,source:'collected',availableOnly:false,scope:'dynamic',sourceIds:[],...extra});
async function refresh(settings:Record<string,unknown>){[connection]=await getDb().update(s.providerConnections).set({settings}).where(eq(s.providerConnections.id,connection.id)).returning();}
async function seedRemote(){for(let i=0;i<3;i++)remote.set(base+i,{title:`Movie ${i}`,ids:{trakt:base+i},collected_at:'2020-01-01T00:00:00.000Z'});
 await getDb().insert(s.collectionProjectionEntries).values([
  {accountId:connection.syncAccountId!,workId:movieIds[0],attribution:'coast-added',remote:{collectedAt:'2020-01-01T00:00:00.000Z',metadata:null}},
  {accountId:connection.syncAccountId!,workId:movieIds[1],attribution:'pre-existing',remote:{collectedAt:'2020-01-01T00:00:00.000Z',metadata:null}},
  {accountId:connection.syncAccountId!,workId:movieIds[2],attribution:'uncertain',remote:{collectedAt:'2020-01-01T00:00:00.000Z',metadata:null}},
 ]);
}
async function approve(input:unknown,choice:string){const preview=await previewProjection(userId,connection.id,input,context());await approveProjection(userId,connection.id,{previewId:preview.id,choice},context());[connection]=await getDb().select().from(s.providerConnections).where(eq(s.providerConnections.id,connection.id));
 const [action]=await getDb().select().from(s.outboxActions).where(and(eq(s.outboxActions.connectionId,connection.id),eq(s.outboxActions.kind,'trakt.collection-cleanup'))).orderBy(s.outboxActions.createdAt);return {preview,action};}
beforeAll(async()=>{if(!enabled)return;
 const [user]=await getDb().insert(s.users).values({username:`projection-${tag}`}).returning();userId=user.id;
 const [instance]=await getDb().insert(s.providerInstances).values({provider:'trakt',name:'Projection fixture',baseUrl:'https://fixture.invalid',serverIdentity:'trakt'}).returning();instanceId=instance.id;
 [connection]=await getDb().insert(s.providerConnections).values({userId,instanceId,externalUserId:`account-${tag}`}).returning();
 for(let i=0;i<101;i++){const movie=await ingestMetadata({provider:'trakt',externalId:String(base+i),kind:'movie',title:`Movie ${i}`,releaseDate:'2020-01-01'});movieIds.push(movie.id);allIds.push(movie.id);
  const show=await ingestMetadata({provider:'trakt',externalId:String(base+200+i),kind:'show',title:`Show ${i}`});showIds.push(show.id);allIds.push(show.id);
  const episode=await ingestMetadata({provider:'trakt',externalId:`${base+200+i}:episode:1:1`,kind:'episode',title:'Episode 1',releaseDate:'2020-01-01',seasonNumber:1,episodeNumber:1},{showId:show.id});episodeIds.push(episode.id);allIds.push(episode.id);
 }
 const [server]=await getDb().insert(s.providerInstances).values({provider:'jellyfin',name:'Availability fixture',baseUrl:'https://fixture.invalid'}).returning();sourceInstance=server.id;
 const [source]=await getDb().insert(s.providerConnections).values({userId,instanceId:sourceInstance,externalUserId:'source-fixture'}).returning();sourceId=source.id;
 const [mapping]=await getDb().insert(s.providerItems).values({instanceId:sourceInstance,mediaId:movieIds[0],externalId:tag,kind:'movie'}).returning();await getDb().insert(s.availability).values({userId,connectionId:sourceId,providerItemId:mapping.id,mediaId:movieIds[0]});
 await getDb().insert(s.syncCheckpoints).values({connectionId:sourceId,kind:'jellyfin-user',completedAt:new Date()});
});
beforeEach(async()=>{if(!enabled)return;remote.clear();writes=[];paths.length=0;showPages=false;lostResponse=false;
 await getDb().delete(s.collectionProjectionEntries).where(eq(s.collectionProjectionEntries.accountId,connection.syncAccountId!));await getDb().delete(s.collectionProjectionPreviews).where(eq(s.collectionProjectionPreviews.connectionId,connection.id));await getDb().delete(s.outboxActions).where(eq(s.outboxActions.userId,userId));await getDb().delete(s.trackingState).where(eq(s.trackingState.userId,userId));
 await refresh({collectionProjection:config()});await getDb().update(s.providerConnections).set({settings:{},status:'connected'}).where(eq(s.providerConnections.id,sourceId));await getDb().update(s.syncCheckpoints).set({completedAt:new Date(),scanId:null}).where(eq(s.syncCheckpoints.connectionId,sourceId));await getDb().update(s.availability).set({state:'available',verifiedAt:new Date()}).where(eq(s.availability.connectionId,sourceId));
});
afterAll(async()=>{if(!userId)return;await getDb().delete(s.users).where(eq(s.users.id,userId));await getDb().delete(s.providerInstances).where(inArray(s.providerInstances.id,[instanceId,sourceInstance]));await getDb().delete(s.media).where(inArray(s.media.id,allIds));});
run('movie and show collections paginate completely; generated projection entries do not become personal collection',async()=>{
 for(let i=0;i<101;i++)remote.set(base+i,{title:`Movie ${i}`,ids:{trakt:base+i},collected_at:'2020-01-01T00:00:00.000Z'});showPages=true;
 expect((await readProjectionRemote(adapter)).size).toBe(202);expect(paths.some(p=>p.includes('/movies?')&&p.includes('page=2'))).toBe(true);expect(paths.some(p=>p.includes('/shows?')&&p.includes('page=2'))).toBe(true);
 await getDb().insert(s.collectionProjectionEntries).values({accountId:connection.syncAccountId!,workId:movieIds[0],attribution:'uncertain',remote:{}});
 await importTraktFromAdapter(userId,connection.id,{adapter,sync:{history:false,progress:false,collection:true,ratings:false,watchlist:false,lists:false,scrobble:false}});
 const states=await getDb().select().from(s.trackingState).where(eq(s.trackingState.userId,userId));expect(states.some(s=>s.mediaId===movieIds[0])).toBe(false);expect(states.filter(s=>s.collected)).toHaveLength(201);expect(await isGeneratedProjection(connection.id,movieIds[0])).toBe(true);
});
run('uncertain delivery survives retry and requires explicit review',async()=>{
 await getDb().insert(s.trackingState).values({userId,mediaId:movieIds[0],collected:true});lostResponse=true;
 await expect(executeProjection(userId,connection.id,undefined,context())).rejects.toThrow('Delivery response lost');await executeProjection(userId,connection.id,undefined,context());expect(writes).toHaveLength(1);
 const preview=await previewProjection(userId,connection.id,config(),context());expect(preview.uncertain.map(e=>e.workId)).toContain(movieIds[0]);
 await reviewProjection(userId,connection.id,{previewId:preview.id,workId:movieIds[0],choice:'coast'},context());
 const [action]=await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.kind,'trakt.collection-review'));await executeProjectionReview(userId,connection.id,action.payload,context());
 const [evidence]=await getDb().select().from(s.collectionProjectionEntries).where(eq(s.collectionProjectionEntries.accountId,connection.syncAccountId!));expect(evidence.attribution).toBe('coast-added');
});
run('remote deletion becomes a conflict and accepting remote changes prevents immediate re-addition',async()=>{
 await getDb().insert(s.trackingState).values({userId,mediaId:movieIds[0],collected:true});await executeProjection(userId,connection.id,undefined,context());remote.delete(base);writes=[];
 const preview=await previewProjection(userId,connection.id,config(),context());expect(preview.conflicts.map(e=>e.workId)).toContain(movieIds[0]);await executeProjection(userId,connection.id,undefined,context());expect(writes).toHaveLength(0);
 await reviewProjection(userId,connection.id,{previewId:preview.id,workId:movieIds[0],choice:'remote'},context());const [action]=await getDb().select().from(s.outboxActions).where(eq(s.outboxActions.kind,'trakt.collection-review'));await executeProjectionReview(userId,connection.id,action.payload,context());await executeProjection(userId,connection.id,undefined,context());expect(writes).toHaveLength(0);
});
for(const choice of ['leave','remove-managed','clear-all'] as const)run(`disabling with ${choice} retains approved cleanup delivery and respects attribution`,async()=>{
 await seedRemote();const {action}=await approve(config({enabled:false}),choice);expect(connection.settings.collectionProjection).toMatchObject({enabled:false});await executeProjection(userId,connection.id,action.payload,context());
 expect(remote.size).toBe(choice==='leave'?3:choice==='remove-managed'?2:0);if(choice==='remove-managed'){expect(remote.has(base+1)).toBe(true);expect(remote.has(base+2)).toBe(true);}
});
run('Replace all removes obsolete external entries while keeping exact desired membership',async()=>{
 await seedRemote();await getDb().insert(s.trackingState).values({userId,mediaId:movieIds[0],collected:true});const {action}=await approve(config(),'replace-all');paths.length=0;await executeProjection(userId,connection.id,action.payload,context());expect([...remote.keys()]).toEqual([base]);
 expect(paths.filter(path=>path==='/sync/collection/remove')).toHaveLength(1);
 expect(paths.filter(path=>path.startsWith('/sync/collection/movies?'))).toHaveLength(2);
});
run('managed removal refuses direct remote changes and stale approval snapshots',async()=>{
 await seedRemote();remote.get(base)!.metadata={resolution:'1080p'};const {action}=await approve(config({enabled:false}),'remove-managed');await executeProjection(userId,connection.id,action.payload,context());expect(remote.size).toBe(3);
 const preview=await previewProjection(userId,connection.id,config({enabled:false}),context());remote.delete(base+1);await expect(approveProjection(userId,connection.id,{previewId:preview.id,choice:'clear-all'},context())).rejects.toThrow('remote Collection changed');
});
run('stale or interrupted sources block shrinkage; intentional source changes are previewed independently',async()=>{
 await getDb().insert(s.trackingState).values({userId,mediaId:movieIds[0],collected:true});await refresh({collectionProjection:config({availableOnly:true})});await executeProjection(userId,connection.id,undefined,context());
 await getDb().update(s.syncCheckpoints).set({completedAt:new Date(Date.now()-3600000),scanId:crypto.randomUUID()}).where(eq(s.syncCheckpoints.connectionId,sourceId));await getDb().update(s.availability).set({state:'unavailable'}).where(eq(s.availability.connectionId,sourceId));
 const preview=await previewProjection(userId,connection.id,config({availableOnly:true}),context());expect(preview.blocked).toBe(true);await expect(approveProjection(userId,connection.id,{previewId:preview.id,choice:'remove-managed'},context())).rejects.toThrow('source assessments');await executeProjection(userId,connection.id,undefined,context());expect(remote.size).toBe(1);
 await expect(validateSourceChange(userId,sourceId,'connection')).rejects.toThrow('Preview');const impact=await previewSourceChange(userId,sourceId,'connection');expect(impact.accounts).toHaveLength(1);await validateSourceChange(userId,sourceId,'connection',impact.id);
 await getDb().transaction(async tx=>{await markSourceChange(tx,[sourceId],true);await tx.update(s.providerConnections).set({status:'disconnected'}).where(eq(s.providerConnections.id,sourceId));});
 expect((await desiredProjection(userId,config({availableOnly:true}))).blocked).toBe(false);
});
run('member-derived parents select no siblings, while Collected parents expand only known released members',async()=>{
 const db=getDb();const showId=showIds[0],firstId=episodeIds[0];
 const released=await ingestMetadata({provider:'trakt',externalId:`${base+200}:episode:1:2`,kind:'episode',title:'Episode 2',releaseDate:'2020-01-02',seasonNumber:1,episodeNumber:2},{showId});
 const future=await ingestMetadata({provider:'trakt',externalId:`${base+200}:episode:1:3`,kind:'episode',title:'Future episode',releaseDate:'2099-01-01',seasonNumber:1,episodeNumber:3},{showId});allIds.push(released.id,future.id);
 await db.insert(s.trackingState).values({userId,mediaId:firstId,favourite:true});const personal=await desiredProjection(userId,config({source:'personal'}));expect([...personal.entries.keys()]).toEqual([firstId]);
 await db.insert(s.trackingState).values({userId,mediaId:showId,collected:true});const collected=await desiredProjection(userId,config());expect(new Set(collected.entries.keys())).toEqual(new Set([firstId,released.id]));expect(collected.entries.has(future.id)).toBe(false);
});
run('account replacement invalidates previews and old running action contexts',async()=>{
 const preview=await previewProjection(userId,connection.id,config(),context()),old=context();
 [connection]=await getDb().update(s.providerConnections).set({externalUserId:`replacement-${tag}`}).where(eq(s.providerConnections.id,connection.id)).returning();
 await expect(approveProjection(userId,connection.id,{previewId:preview.id,choice:'leave'},context())).rejects.toThrow('expired');
 await expect(executeProjection(userId,connection.id,undefined,old)).rejects.toThrow('account changed');
});
