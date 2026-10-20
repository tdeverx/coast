import {test,expect,spyOn} from 'bun:test';
import {eq} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {getConfig} from '../src/lib/server/config';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import type {JellyfinBook} from '../src/lib/providers/jellyfin/reading.server';
import {syncJellyfinUser} from '../src/lib/sync/jellyfin.server';
import {jobExecution,JobYield} from '../src/lib/server/queue/execution';
import {importReading} from '../src/lib/catalogue/reading.server';
import {importJellyfinReading} from '../src/lib/sync/jellyfin-reading.server';
import {libraryContent} from '../src/lib/server/queries/library-content';
import * as readingProviders from '../src/lib/providers/reading.server';
import {AppError} from '../src/lib/server/security/errors';
import {ProviderHttpError} from '../src/lib/server/security/provider-fetch';
import {ownedReadingSession,linkedReadingSources} from '../src/lib/reading/sessions.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
run('Jellyfin reading imports commit their cursor before yielding, including skipped files',async()=>{
 const db=getDb(),config=await getConfig(),tag=crypto.randomUUID();
 await db.insert(s.systemSettings).values({key:'coast',value:{...config,developerMode:true,experimentalMusic:false,experimentalBooks:true,experimentalComics:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,developerMode:true,experimentalMusic:false,experimentalBooks:true,experimentalComics:true}}});
 const [user]=await db.insert(s.users).values({username:`reading-sync-${tag}`}).returning();
 const [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid',serverIdentity:tag}).returning();
 const [connection]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:instance.id,externalUserId:tag,credentials:'synthetic',settings:{importPlayback:false}}).returning();
 const books:JellyfinBook[]=[];
 for(let index=0;index<7;index++){
  const externalId=`OL981237${index}W`;
  await importReading({provider:'openlibrary',externalId,kind:'book',title:`Reading sync ${index}`,sourceUrl:`https://openlibrary.org/works/${externalId}`,authors:[],subjects:[]});
  books.push({Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Name:`Reading sync ${index}`,Path:`/books/${index}.pdf`,Etag:'v1',ProviderIds:{OpenLibrary:externalId}});
 }
 books.splice(2,0,{Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Name:'Not an issue identity',Path:'/books/ambiguous.pdf',Etag:'v1',ProviderIds:{ComicVine:'12345'}},{Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Name:'Unsupported format',Path:'/books/archive.mobi',Etag:'v1',ProviderIds:{}});
 const offsets:number[]=[];
 const adapter=new JellyfinAdapter(async path=>{
  const url=new URL(path,'https://fixture.invalid');
  if(url.pathname==='/System/Info/Public')return {Id:tag,ServerName:'Fixture',ProductName:'Jellyfin Server',Version:'10.11.0'};
  if(url.pathname==='/Users/Me')return {Id:tag,ServerId:tag,Policy:{MaxParentalRating:1}};
  if(url.pathname!=='/Items')throw new Error(`Unexpected reading request: ${url.pathname}`);
  const reading=url.searchParams.get('IncludeItemTypes')==='Book',offset=Number(url.searchParams.get('StartIndex')??url.searchParams.get('startIndex')??0);
  if(reading)offsets.push(offset);
  return {Items:reading?books.slice(offset,offset+60):[],TotalRecordCount:reading?books.length:0,StartIndex:offset};
 },user.id,'synthetic');
 const [job]=await db.insert(s.outboxActions).values({userId:user.id,connectionId:connection.id,accountGeneration:connection.accountGeneration,kind:'jellyfin.sync',state:'running',attempts:1,payload:{}}).returning();
 let complete=false;const checkpoints:number[]=[];
 for(let attempt=0;attempt<12&&!complete;attempt++){
  const [fresh]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,connection.id));
  try{await jobExecution.run({id:job.id,attempts:1,purpose:'manual',started:performance.now(),checkpoints:0},()=>syncJellyfinUser(user.id,connection.id,undefined,{adapter,connection:fresh,instance}));complete=true;}
  catch(cause){if(!(cause instanceof JobYield))throw cause;const [saved]=await db.select().from(s.outboxActions).where(eq(s.outboxActions.id,job.id));const progress=saved.payload._checkpoint as {task:string;offset:number};if(progress.task==='jellyfin-reading-access')checkpoints.push(progress.offset);}
 }
 expect(complete).toBe(true);expect(checkpoints.some(offset=>offset>0&&offset<books.length)).toBe(true);
 expect(offsets).toEqual([...offsets].sort((a,b)=>a-b));expect(offsets.at(-1)).toBeGreaterThan(0);
 const available=await db.select().from(s.availability).where(eq(s.availability.connectionId,connection.id));expect(available).toHaveLength(7);
 expect(new Set(available.map(row=>row.mediaId)).size).toBe(7);
 expect((await getSql()`SELECT count(*)::int AS count FROM reading_progress WHERE user_id=${user.id}`)[0].count).toBe(0);
});

run('Jellyfin comic permalinks populate Library without Collection and keep unsupported files out of reader availability',async()=>{
 const db=getDb(),config=await getConfig(),tag=crypto.randomUUID();
 await db.insert(s.systemSettings).values({key:'coast',value:{...config,experimentalBooks:true,experimentalComics:true}}).onConflictDoUpdate({target:s.systemSettings.key,set:{value:{...config,experimentalBooks:true,experimentalComics:true}}});
 const [user]=await db.insert(s.users).values({username:`comic-sync-${tag}`}).returning();
 const [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid',serverIdentity:tag}).returning();
 const [connection]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:instance.id,externalUserId:tag,credentials:'synthetic'}).returning();
 const adapter=new JellyfinAdapter(async()=>{throw new Error('Unexpected Jellyfin request');},user.id,'synthetic');
 const page:JellyfinBook[]=[
  {Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Path:'/comics/one.cbz',ProviderIds:{ComicVine:'fixture-comic/4000-987654321'}},
  {Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Path:'/comics/two.cbr',ProviderIds:{ComicVine:'https://comicvine.gamespot.com/fixture-comic/4000-987654322/'}},
  {Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Path:'/comics/three.cb7',ProviderIds:{ComicVine:'4000-987654324'}},
  {Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Path:'/comics/four.cbt',ProviderIds:{ComicVine:'4000-987654325'}},
  {Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Path:'/comics/five.mobi',ProviderIds:{ComicVine:'4000-987654326'}},
  {Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Path:'/comics/volume.cbz',ProviderIds:{ComicVine:'fixture-comic/4050-987654323'}},
 ];
 const metadata=spyOn(readingProviders,'readingProviderDetails').mockImplementation(async(kind,externalId)=>({provider:'comic-vine',externalId,kind,title:`Fixture ${externalId}`,sourceUrl:`https://comicvine.gamespot.com/fixture-comic/${externalId}/`,authors:[],subjects:[]}));
 const checkpoints:number[]=[];
 try {
  expect(await importJellyfinReading({adapter,connection,instance},page,{access:true,checkpoint:async processed=>{checkpoints.push(processed);}})).toBe(5);
  expect(metadata.mock.calls.map(call=>call[1])).toEqual(['4000-987654321','4000-987654322','4000-987654324','4000-987654325','4000-987654326']);
  expect(checkpoints).toEqual([1,2,3,4,5,6]);
  const all=await libraryContent(user.id,new URL('http://coast/library?surface=read&kind=comic&scope=all'));
  expect(all.items.map(item=>item.title)).toEqual(['Fixture 4000-987654321','Fixture 4000-987654322','Fixture 4000-987654324','Fixture 4000-987654325','Fixture 4000-987654326']);
  const available=await libraryContent(user.id,new URL('http://coast/library?surface=read&kind=comic&scope=available'));
  expect(available.items.map(item=>item.title)).toEqual(['Fixture 4000-987654321','Fixture 4000-987654322','Fixture 4000-987654324','Fixture 4000-987654325']);
  for(const item of available.items)expect(await linkedReadingSources(user.id,item.id)).toHaveLength(1);
  expect(await db.select().from(s.trackingState).where(eq(s.trackingState.userId,user.id))).toHaveLength(0);
  expect(await db.select().from(s.readingProgress).where(eq(s.readingProgress.userId,user.id))).toHaveLength(0);
  expect(await db.select().from(s.workEditions).where(eq(s.workEditions.instanceId,instance.id))).toHaveLength(4);
 } finally {metadata.mockRestore();}
});

run('reading matching normalizes file IDs, holds corrected identities, and advances past missing metadata only',async()=>{
 const db=getDb(),tag=crypto.randomUUID();
 const [user]=await db.insert(s.users).values({username:`matching-${tag}`}).returning();
 const [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:tag,baseUrl:'https://fixture.invalid'}).returning();
 const [connection]=await db.insert(s.providerConnections).values({userId:user.id,instanceId:instance.id,externalUserId:tag,credentials:'synthetic'}).returning();
 const adapter=new JellyfinAdapter(async()=>{throw new Error('Unexpected Jellyfin read');},user.id,'synthetic');
 const context={adapter,connection,instance};
 const file=(Id:string,ProviderIds:Record<string,string>):JellyfinBook=>({Id,Type:'Book',Path:'/fixture/file.cbz',ProviderIds});
 const key=crypto.randomUUID(),book=file(key,{OpenLibrary:'https://openlibrary.org/works/OL999000001W/'});
 const metadata=spyOn(readingProviders,'readingProviderDetails').mockImplementation(async(kind,externalId)=>{
  if(externalId==='4000-999000099')throw new AppError(404,'Missing issue','not_found');
  if(externalId==='4000-999000098')throw new ProviderHttpError(503);
  return {provider:externalId.startsWith('OL')?'openlibrary':'comic-vine',externalId,kind,title:externalId,sourceUrl:externalId.startsWith('OL')?`https://openlibrary.org/works/${externalId}`:`https://comicvine.gamespot.com/fixture/${externalId}/`,authors:[],subjects:[]};
 });
 try{
  expect(await importJellyfinReading(context,[book],{access:true})).toBe(1);
  const [original]=await db.select().from(s.workEditions).where(eq(s.workEditions.instanceId,instance.id));
  await db.insert(s.readingProgress).values({userId:user.id,workId:original.workId,state:'reading',page:15,totalPages:100});
  expect(await importJellyfinReading(context,[{...book,Id:key.replaceAll('-','').toUpperCase()}],{access:true})).toBe(1);
  expect(await db.select().from(s.workEditions).where(eq(s.workEditions.instanceId,instance.id))).toHaveLength(1);
  const [session]=await db.insert(s.readingSessions).values({userId:user.id,workId:original.workId,format:'cbz',edition:'fixture',connectionId:connection.id,accountGeneration:connection.accountGeneration,externalId:key,expiresAt:new Date(Date.now()+60000)}).returning();
  expect(await importJellyfinReading(context,[{...book,ProviderIds:{OpenLibrary:'OL999000002W'}}],{access:true})).toBe(0);
  const [held]=await db.select().from(s.workEditions).where(eq(s.workEditions.id,original.id));
  expect(held.workId).toBe(original.workId);expect(held.metadata.identityConflict).toBe(true);
  expect((await db.select().from(s.availability).where(eq(s.availability.connectionId,connection.id)))[0].state).toBe('unknown');
  await expect(ownedReadingSession(user.id,session.id)).rejects.toMatchObject({status:410});
  expect((await db.select().from(s.readingProgress).where(eq(s.readingProgress.userId,user.id)))[0]).toMatchObject({workId:original.workId,page:15});
  expect(await importJellyfinReading(context,[{...book,ProviderIds:{}}],{access:true})).toBe(0);
  expect((await db.select().from(s.availability).where(eq(s.availability.connectionId,connection.id)))[0].state).toBe('unknown');
  expect(await importJellyfinReading(context,[book],{access:true})).toBe(1);
  expect((await db.select().from(s.availability).where(eq(s.availability.connectionId,connection.id)))[0].state).toBe('available');
  const checkpoints:number[]=[];
  expect(await importJellyfinReading(context,[file(crypto.randomUUID(),{ComicVine:'4000-999000099'}),file(crypto.randomUUID(),{ComicVine:'4000-999000003'})],{access:true,checkpoint:async n=>{checkpoints.push(n);}})).toBe(1);
  expect(checkpoints).toEqual([1,2]);
  checkpoints.length=0;
  await expect(importJellyfinReading(context,[file(crypto.randomUUID(),{ComicVine:'4000-999000098'}),file(crypto.randomUUID(),{ComicVine:'4000-999000004'})],{access:true,checkpoint:async n=>{checkpoints.push(n);}})).rejects.toMatchObject({status:503});
  expect(checkpoints).toEqual([]);
  expect(metadata.mock.calls.some(call=>call[1]==='4000-999000004')).toBe(false);
  expect((await getSql()`select indexname from pg_indexes where indexname='provider_items_instance_guid_idx'`)).toHaveLength(1);
 }finally{metadata.mockRestore();}
});
