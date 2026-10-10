import {beforeAll,afterAll,describe,test,expect} from 'bun:test';
import {getDb,getSql,closeDb} from '../src/lib/server/db';
import {migrate} from 'drizzle-orm/bun-sql/migrator';
import {createFirstAdmin,createUser,updatePassword,type SessionUser} from '../src/lib/server/auth';
import {createApiToken,listApiTokens,revokeApiToken,authenticateApiToken} from '../src/lib/server/public-api/tokens.server';
import {publicApiHandler} from '../src/lib/server/public-api/handler.server';
import {publicProgress} from '../src/lib/server/public-api/progress.server';
import * as s from '../src/lib/server/db/schema';
import type {MediaCardPresentation} from '../src/lib/ui/types';
import { getConfig } from '../src/lib/server/config';
import { importReading } from '../src/lib/catalogue/reading.server';
import { updateReading } from '../src/lib/core/reading/service.server';
const target=process.env.TEST_DATABASE_URL;
const enabled=!!target&&new URL(target).pathname.startsWith('/coast_settings_test');
describe.skipIf(!enabled)('scoped public API',()=>{
 let owner:SessionUser,other:SessionUser;
 beforeAll(async()=>{process.env.DATABASE_URL=target;await closeDb();await migrate(getDb(),{migrationsFolder:'drizzle'});owner=(await createFirstAdmin({username:'api-owner',password:'API-owner-passphrase!'})).user;other=await createUser(owner,{username:'api-other',password:'API-other-passphrase!'});});
 afterAll(closeDb);
 async function read(token:string,path='me',method='GET',query=''){
  const request=new Request(`http://coast.test/api/public/v1/${path}${query}`,{method,headers:{authorization:`Bearer ${token}`}});
  return publicApiHandler({request,url:new URL(request.url),params:{path}} as Parameters<typeof publicApiHandler>[0]);
 }
 test('server module reloads reuse the process database pool',async()=>{
  const modulePath='../src/lib/server/db/index.ts?public-api-pool-check';
  const reloaded=await import(modulePath);
  expect(reloaded.getSql()).toBe(getSql());
 });
 test('hashes credentials, only shows secrets on creation and binds reads to their owner',async()=>{
  const created=await createApiToken(other,{name:'Reader',scopes:['collection:read']});
  const rows=await listApiTokens(other);expect(JSON.stringify(rows)).not.toContain(created.token);expect(rows[0].id).toBe(created.id);
  const [stored]=await getSql()`select token_hash from api_tokens where id=${created.id}`;expect(stored.token_hash).not.toContain(created.token);
  const response=await read(created.token);expect(response.status).toBe(200);const identity=await response.json();expect(identity.id).toBe(other.id);expect(identity.scopes).toEqual(['collection:read']);
  expect((await read(created.token,'catalogue')).status).toBe(403);
  expect((await read(created.token,'collection','GET','?username=api-owner')).status).toBe(400);
  expect((await read(created.token,'collection','GET','?page=1&page=2')).status).toBe(400);
  expect((await read(created.token,'collection','GET','?page=0')).status).toBe(400);
  const page=await read(created.token,'collection');expect(page.status).toBe(200);expect((await page.json()).pagination.pageSize).toBe(60);
 });
 test('never accepts browser cookies; authenticates before dispatch and rejects unknown grants',async()=>{
  const request=new Request('http://coast.test/api/public/v1/me',{headers:{cookie:'coast_session=fake'}});
  const response=await publicApiHandler({request,url:new URL(request.url),params:{path:'me'}} as Parameters<typeof publicApiHandler>[0]);
  expect(response.status).toBe(401);expect(response.headers.get('www-authenticate')).toContain('Bearer');
  expect((await read('irrelevant','collection','POST')).status).toBe(401);
  expect((await read('irrelevant','collection','HEAD')).status).toBe(401);
  await expect(createApiToken(owner,{name:'Bad',scopes:['admin:write']})).rejects.toThrow();
 });
 test('writes are scoped, atomic and replay without duplicate events or deliveries',async()=>{
  const db=getDb(),[movie]=await db.insert(s.media).values({kind:'movie',title:'Mutation fixture'}).returning();
  const reader=await createApiToken(other,{name:'Read only',scopes:['collection:read']});
  const writer=await createApiToken(other,{name:'Writer',scopes:['tracking:write','relationships:write','ratings:write','webhooks:manage']});
  async function write(token:string,path:string,data:unknown,key:string,method='POST'){
   const request=new Request(`http://coast.test/api/public/v1/${path}`,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(data)});
   return publicApiHandler({request,url:new URL(request.url),params:{path}} as Parameters<typeof publicApiHandler>[0]);
  }
  expect((await write(reader.token,'tracking',{mediaId:movie.id,action:'watch'},'no-grant')).status).toBe(403);
  const subscribed=await write(writer.token,'webhooks',{url:'https://example.com/coast-events',events:['tracking.changed','relationship.changed']},'subscription');
  expect(subscribed.status).toBe(201);const subscription=await subscribed.json();expect(subscription.secret).toHaveLength(43);
  const [stored]=await getSql()`select response from api_idempotency where token_id=${writer.id} and key='subscription'`;
  expect(stored.response).not.toContain(subscription.secret);
  const first=await write(writer.token,'tracking',{mediaId:movie.id,action:'watch'},'watch-1');expect(first.status).toBe(200);expect(await first.json()).toEqual({changed:true});
  const parallel=await Promise.all(Array.from({length:3},()=>write(writer.token,'tracking',{action:'watch',mediaId:movie.id},'watch-1')));
  for(const response of parallel){expect(response.status).toBe(200);expect(response.headers.get('idempotency-replayed')).toBe('true');}
  const [events]=await getSql()`select count(*)::int as total from tracking_events where user_id=${other.id} and media_id=${movie.id}`;expect(events.total).toBe(1);
  const deliveries=await getSql()`select payload from outbox_actions where user_id=${other.id} and kind='webhook.deliver'`;expect(deliveries).toHaveLength(1);expect(deliveries[0].payload.event.data.workId).toBe(movie.id);
  expect((await write(writer.token,'tracking',{mediaId:movie.id,action:'unwatch'},'watch-1')).status).toBe(409);
  expect((await write(writer.token,'tracking',{mediaId:movie.id,action:'collect'},'scope-bypass')).status).toBe(400);
  expect((await write(writer.token,'tracking',{mediaId:movie.id,action:'watch',source:'jellyfin'},'source-bypass')).status).toBe(400);
  expect((await write(writer.token,`relationships/${movie.id}`,{relationship:'saved',value:true},'save','PUT')).status).toBe(200);
  expect((await write(writer.token,`ratings/${movie.id}`,{value:4.5},'rating','PUT')).status).toBe(200);
  expect((await write(writer.token,'webhooks',{url:'https://127.0.0.1/events',events:['tracking.changed']},'private-endpoint')).status).toBe(400);
  expect((await write(writer.token,'tracking',{mediaId:crypto.randomUUID(),action:'watch'},'missing-work')).status).toBe(404);
  const [failed]=await getSql()`select count(*)::int as total from api_idempotency where token_id=${writer.id} and key='missing-work'`;expect(failed.total).toBe(0);
 });
 test('migration repairs old serialized read grants and malformed grants remain rejected',async()=>{
  const legacy=await createApiToken(other,{name:'Legacy storage',scopes:['collection:read']});
  await getSql()`update api_tokens set scopes=${JSON.stringify(['collection:read'])}::jsonb where id=${legacy.id}`;
  expect((await read(legacy.token)).status).toBe(401);
  const migration=await Bun.file('drizzle/0037_foamy_unicorn.sql').text();
  const repair=migration.slice(migration.indexOf('UPDATE api_tokens SET scopes=')).split('--> statement-breakpoint')[0];
  await getSql().unsafe(repair);const identity=await (await read(legacy.token)).json();expect(identity.scopes).toEqual(['collection:read']);
  await getSql()`update api_tokens set scopes=${'admin:write'}::jsonb where id=${legacy.id}`;
  expect((await read(legacy.token)).status).toBe(401);
 });
 test('owner-only revocation, expiry and disabled users reject previously valid tokens',async()=>{
  const created=await createApiToken(other,{name:'Revocable',scopes:['catalogue:read']});
  await expect(revokeApiToken(owner,created.id)).rejects.toThrow('Token not found');
  await revokeApiToken(other,created.id);expect((await read(created.token)).status).toBe(401);
  const expiring=await createApiToken(other,{name:'Expired',scopes:['catalogue:read']});
  await getSql()`update api_tokens set expires_at=now()-interval '1 second' where id=${expiring.id}`;expect((await read(expiring.token)).status).toBe(401);
  const disabled=await createApiToken(other,{name:'Disabled',scopes:['catalogue:read']});await getSql()`update users set disabled=true where id=${other.id}`;
  expect((await read(disabled.token)).status).toBe(401);await getSql()`update users set disabled=false where id=${other.id}`;
 });
 test('parallel requests share an atomic quota and return Retry-After',async()=>{
  const created=await createApiToken(other,{name:'Budget',scopes:['catalogue:read']});
  await getSql()`update api_tokens set window_requests=118 where id=${created.id}`;
  const responses=await Promise.all(Array.from({length:6},()=>read(created.token)));
  expect(responses.filter(response=>response.status===200)).toHaveLength(2);
  expect(responses.filter(response=>response.status===429)).toHaveLength(4);
  expect(responses.find(response=>response.status===429)?.headers.get('retry-after')).toBe('60');
  await getSql()`update api_tokens set window_started_at=now()-interval '2 minutes' where id=${created.id}`;expect((await read(created.token)).status).toBe(200);
 });
 test('password changes revoke machine credentials as well as sessions',async()=>{
  const created=await createApiToken(other,{name:'Password',scopes:['catalogue:read']});
  await updatePassword(other,'API-other-passphrase!','API-replacement-passphrase!');
  await expect(authenticateApiToken(new Request('http://coast.test',{headers:{authorization:`Bearer ${created.token}`}}))).rejects.toThrow('invalid or expired');
 });
 test('concrete progress is owner-scoped and excludes private session notes',async()=>{
  const db=getDb();const [game]=await db.insert(s.games).values({title:'API privacy game'}).returning();
  const [play]=await db.insert(s.gamePlaythroughs).values({gameId:game.id,userId:other.id,status:'in-progress',progressPercent:25}).returning();
  await db.insert(s.gameSessions).values({id:crypto.randomUUID(),playthroughId:play.id,minutesPlayed:30,playedAt:new Date(),note:'private fixture note'});
  const card={id:game.id,kind:'game',title:game.title} as MediaCardPresentation;
  const own=await publicProgress(other.id,[card]);expect(JSON.stringify(own)).toContain('minutesPlayed');expect(JSON.stringify(own)).not.toContain('private fixture note');
  expect(own[0]).toHaveProperty('game.progressPercent',25);
  expect((await publicProgress(owner.id,[card]))[0]).toHaveProperty('game',null);
 });
 test('Library access is scoped to the token owner and paginates before hydration',async()=>{
  const db=getDb();const [instance]=await db.insert(s.providerInstances).values({provider:'jellyfin',name:'API library fixture',baseUrl:'https://fixture.invalid'}).returning();
  const [connection]=await db.insert(s.providerConnections).values({userId:other.id,instanceId:instance.id,status:'connected'}).returning();
  const [movie]=await db.insert(s.media).values({kind:'movie',title:'Accessible API movie'}).returning();
  const [item]=await db.insert(s.providerItems).values({instanceId:instance.id,mediaId:movie.id,externalId:'movie',kind:'movie'}).returning();
  await db.insert(s.availability).values({userId:other.id,connectionId:connection.id,providerItemId:item.id,mediaId:movie.id});
  await db.insert(s.trackingState).values({userId:other.id,mediaId:movie.id,positionSeconds:120,favourite:true});
  const reader=await createApiToken(other,{name:'Library',scopes:['library:read']});const stranger=await createApiToken(owner,{name:'Library',scopes:['library:read']});
  const own=await read(reader.token,'library');expect(own.status).toBe(200);const body=await own.json();expect(body.items.map((item:{id:string})=>item.id)).toEqual([movie.id]);expect(body.pagination.pageSize).toBe(60);
  expect(body.items).toEqual([{id:movie.id,kind:'movie',title:movie.title,year:null}]);
  expect(Object.keys(body.pagination).sort()).toEqual(['next','page','pageSize','pages','previous','total']);
  expect(JSON.stringify(body)).not.toContain(connection.id);
  expect((await read(reader.token,'progress')).status).toBe(403);
  expect((await (await read(stranger.token,'library')).json()).items).toHaveLength(0);
  expect((await read(reader.token,'library','GET','?selection=watched')).status).toBe(400);
 });
 test('reading writes and history use scoped, owner-only and idempotent public contracts',async()=>{
  const db=getDb(),config=await getConfig();
  let fixtureId:string|undefined;
  const save=async(value:typeof config)=>db.insert(s.systemSettings).values({key:'coast',value}).onConflictDoUpdate({target:s.systemSettings.key,set:{value}});
  await save({...config,experimentalBooks:true});
  try{
   const book=await importReading({provider:'openlibrary',externalId:'OL987654322W',kind:'book',title:'API journal',sourceUrl:'https://openlibrary.org/works/OL987654322W',authors:[],subjects:[]});
   fixtureId=book.id;
   const reader=await createApiToken(owner,{name:'Journal reader',scopes:['progress:read']});
   const writer=await createApiToken(other,{name:'Journal writer',scopes:['reading:write','progress:read','webhooks:manage','library:read']});
   async function write(token:string,path:string,body:unknown,key:string,method='PUT'){
    const request=new Request(`http://coast.test/api/public/v1/${path}`,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});
    return publicApiHandler({request,url:new URL(request.url),params:{path}} as Parameters<typeof publicApiHandler>[0]);
   }
   expect((await write(reader.token,`reading/${book.id}/progress`,{state:'reading',page:1,totalPages:10},'denied')).status).toBe(403);
   expect((await write(writer.token,'webhooks',{url:'https://example.com/reading',events:['reading.changed']},'reading-subscription','POST')).status).toBe(201);
   const path=`reading/${book.id}/progress`,body={state:'completed',page:10,totalPages:10};
   expect((await write(writer.token,path,body,'complete-read')).status).toBe(200);
   const repeated=await write(writer.token,path,body,'complete-read');expect(repeated.status).toBe(200);expect(repeated.headers.get('idempotency-replayed')).toBe('true');
   expect((await write(writer.token,path,{page:9},'complete-read')).status).toBe(409);
   const [events]=await getSql()`select count(*)::int as total from reading_history where user_id=${other.id} and work_id=${book.id}`;expect(events.total).toBe(1);
   const deliveries=await getSql()`select payload from outbox_actions where user_id=${other.id} and kind='webhook.deliver' and payload->'event'->>'type'='reading.changed'`;
   expect(deliveries).toHaveLength(1);
   expect((await (await read(writer.token,`reading/${book.id}/history`)).json()).items[0]).toMatchObject({state:'completed',page:10,totalPages:10});
   expect((await (await read(reader.token,`reading/${book.id}/history`)).json()).items).toEqual([]);
   expect((await read(writer.token,`reading/${book.id}/history`,'GET','?username=api-owner')).status).toBe(400);
   expect((await write(writer.token,path,{restart:true,state:'reading',page:0},'reread')).status).toBe(200);
   expect((await (await read(writer.token,`reading/${book.id}/history`)).json()).pagination.total).toBe(2);
   const [connection]=await getSql()`select id,instance_id from provider_connections where user_id=${other.id} limit 1`;
   const [item]=await db.insert(s.providerItems).values({instanceId:connection.instance_id,mediaId:book.id,externalId:'api-reading-item',kind:'book'}).returning();
   await db.insert(s.availability).values({userId:other.id,connectionId:connection.id,providerItemId:item.id,mediaId:book.id});
   const library=await read(writer.token,'library','GET','?category=reading');expect(library.status).toBe(200);expect((await library.json()).items.map((item:{id:string})=>item.id)).toContain(book.id);
   await save({...config,experimentalBooks:false});
   expect((await write(writer.token,path,{page:1},'disabled')).status).toBe(404);
   expect((await read(writer.token,`reading/${book.id}/history`)).status).toBe(404);
  }finally{if(fixtureId)await getSql()`delete from works where id=${fixtureId}`;await save(config);}
 });
 test('reading catalogue gates filter counts and direct IDs and retain comic attribution',async()=>{
  const db=getDb(), config=await getConfig();
  const save=async(value:typeof config)=>db.insert(s.systemSettings).values({key:'coast',value}).onConflictDoUpdate({target:s.systemSettings.key,set:{value}});
  await save({...config,experimentalBooks:true,experimentalComics:true});
  try {
   const book=await importReading({provider:'openlibrary',externalId:'OL987654321W',kind:'book',title:'API book',sourceUrl:'https://openlibrary.org/works/OL987654321W',authors:[],subjects:[]});
   const comic=await importReading({provider:'comic-vine',externalId:'4000-987654321',kind:'comic',title:'API comic',sourceUrl:'https://comicvine.gamespot.com/api-comic/4000-987654321/',authors:[],subjects:[]});
   const reader=await createApiToken(other,{name:'Reading catalogue',scopes:['catalogue:read']});
   const books=await read(reader.token,'catalogue','GET','?category=book');
   expect(books.status).toBe(200);expect((await books.json()).items).toEqual([{id:book.id,kind:'book',title:book.title,year:null}]);
   const issue=await read(reader.token,`catalogue/${comic.id}`);expect(issue.status).toBe(200);
   expect(await issue.json()).toHaveProperty('attribution',{label:'Comic Vine',href:comic.sourceUrl});
   await updateReading(other.id,book.id,{page:20,totalPages:100});
   await updateReading(owner.id,book.id,{page:50,totalPages:200});
   expect((await read(reader.token,'progress','GET','?category=reading')).status).toBe(403);
   const progressReader=await createApiToken(other,{name:'Reading progress',scopes:['progress:read']});
   const progress=await read(progressReader.token,'progress','GET','?category=reading&view=watching&kind=book');
   expect(progress.status).toBe(200);
   const current=(await progress.json()).items[0];
   expect(current.id).toBe(book.id);expect(current.reading).toMatchObject({state:'reading',page:20,totalPages:100});
   expect(current).not.toHaveProperty('positionSeconds');expect(current).not.toHaveProperty('music');
   await save({...config,experimentalBooks:true,experimentalComics:false});
   expect((await read(reader.token,`catalogue/${comic.id}`)).status).toBe(404);
   const disabled=await (await read(reader.token,'catalogue','GET','?category=comic')).json();
   expect(disabled.items).toEqual([]);expect(disabled.pagination.total).toBe(0);
   expect((await read(reader.token,`catalogue/${book.id}`)).status).toBe(200);
   await save({...config,experimentalBooks:false,experimentalComics:false});
   expect((await read(progressReader.token,'progress','GET','?category=reading')).status).toBe(404);
  } finally {await save(config);}
 });
});
