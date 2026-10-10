import {test,expect} from 'bun:test';
import {eq} from 'drizzle-orm';
import {getDb,getSql} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {getConfig} from '../src/lib/server/config';
import {JellyfinAdapter} from '../src/lib/providers/jellyfin/adapter.server';
import type {JellyfinBook} from '../src/lib/providers/jellyfin/reading.server';
import {syncJellyfinUser} from '../src/lib/sync/jellyfin.server';
import {jobExecution,JobYield} from '../src/lib/server/queue/execution';
import {importReading} from '../src/lib/catalogue/reading.server';
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
 books.splice(2,0,{Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Name:'Not an issue identity',Path:'/books/ambiguous.pdf',Etag:'v1',ProviderIds:{ComicVine:'12345'}},{Id:crypto.randomUUID().replaceAll('-',''),Type:'Book',Name:'Unsupported archive',Path:'/books/archive.cbr',Etag:'v1',ProviderIds:{}});
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
  catch(cause){if(!(cause instanceof JobYield))throw cause;const [saved]=await db.select().from(s.providerConnections).where(eq(s.providerConnections.id,connection.id));const progress=saved.settings.userSync as {phase:string;readingOffset?:number};if(progress.phase==='reading')checkpoints.push(progress.readingOffset??0);}
 }
 expect(complete).toBe(true);expect(checkpoints.some(offset=>offset>0&&offset<books.length)).toBe(true);
 expect(offsets).toEqual([...offsets].sort((a,b)=>a-b));expect(offsets.at(-1)).toBeGreaterThan(0);
 const available=await db.select().from(s.availability).where(eq(s.availability.connectionId,connection.id));expect(available).toHaveLength(7);
 expect(new Set(available.map(row=>row.mediaId)).size).toBe(7);
 expect((await getSql()`SELECT count(*)::int AS count FROM reading_progress WHERE user_id=${user.id}`)[0].count).toBe(0);
});
