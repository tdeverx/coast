import {beforeAll,afterAll,describe,test,expect} from 'bun:test';
import {getDb,getSql,closeDb} from '../src/lib/server/db';
import {migrate} from 'drizzle-orm/bun-sql/migrator';
import {createFirstAdmin,createUser,updatePassword,type SessionUser} from '../src/lib/server/auth';
import {createApiToken,listApiTokens,revokeApiToken,authenticateApiToken} from '../src/lib/server/public-api/tokens.server';
import {publicApiHandler} from '../src/lib/server/public-api/handler.server';
import {publicProgress} from '../src/lib/server/public-api/progress.server';
import * as s from '../src/lib/server/db/schema';
import type {MediaCardPresentation} from '../src/lib/ui/types';
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
  const response=await read(created.token);expect(response.status).toBe(200);expect((await response.json()).id).toBe(other.id);
  expect((await read(created.token,'catalogue')).status).toBe(403);
  expect((await read(created.token,'collection','GET','?username=api-owner')).status).toBe(400);
  expect((await read(created.token,'collection','GET','?page=1&page=2')).status).toBe(400);
  expect((await read(created.token,'collection','GET','?page=0')).status).toBe(400);
  const page=await read(created.token,'collection');expect(page.status).toBe(200);expect((await page.json()).pagination.pageSize).toBe(60);
 });
 test('never accepts browser cookies or writes; rejects unknown grants',async()=>{
  const request=new Request('http://coast.test/api/public/v1/me',{headers:{cookie:'coast_session=fake'}});
  const response=await publicApiHandler({request,url:new URL(request.url),params:{path:'me'}} as Parameters<typeof publicApiHandler>[0]);
  expect(response.status).toBe(401);expect(response.headers.get('www-authenticate')).toContain('Bearer');
  expect((await read('irrelevant','collection','POST')).status).toBe(405);
  expect((await read('irrelevant','collection','HEAD')).status).toBe(405);
  await expect(createApiToken(owner,{name:'Bad',scopes:['admin:write']})).rejects.toThrow();
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
  const reader=await createApiToken(other,{name:'Library',scopes:['library:read']});const stranger=await createApiToken(owner,{name:'Library',scopes:['library:read']});
  const own=await read(reader.token,'library');expect(own.status).toBe(200);const body=await own.json();expect(body.items.map((item:{id:string})=>item.id)).toEqual([movie.id]);expect(body.pagination.pageSize).toBe(60);
  expect((await (await read(stranger.token,'library')).json()).items).toHaveLength(0);
  expect((await read(reader.token,'library','GET','?selection=watched')).status).toBe(400);
 });
});
