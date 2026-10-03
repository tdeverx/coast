import {beforeAll,afterAll,test,expect} from 'bun:test';
import {getSql,closeDb} from '../src/lib/server/db';
import {getConfig,defaultConfig} from '../src/lib/server/config';
import {updateConfig} from '../src/lib/application/configuration.server';
import {createFirstAdmin,type SessionUser} from '../src/lib/server/auth';
import {collectionData} from '../src/lib/collection/query.server';
import {listsData} from '../src/lib/server/queries/lists';
import {activityFeed} from '../src/lib/social/queries.server';
import {createRoom,leaveRoom} from '../src/lib/playback/synced/service.server';
import {createApiToken} from '../src/lib/server/public-api/tokens.server';
import {publicApiHandler} from '../src/lib/server/public-api/handler.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const movie=crypto.randomUUID(),game=crypto.randomUUID(),track=crypto.randomUUID();
let admin:SessionUser,token:string;
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 admin=(await createFirstAdmin({username:'feature-admin',password:'Feature-test-passphrase!'})).user;
 const sql=getSql();
 await sql`insert into media(id,kind,title) values(${movie},'movie','Feature movie')`;
 await sql`insert into games(id,title) values(${game},'Feature game')`;
 await sql`insert into works(id,category,kind) values(${track},'music','track')`;
 await sql`insert into music_works(id,kind,title) values(${track},'track','Feature track')`;
 for(const id of [movie,game,track]){
  await sql`insert into tracking_state(user_id,media_id,collected,favourite) values(${admin.id},${id},true,true)`;
  await sql`insert into social_activity(user_id,work_id,source_key,event_kind,section,source,occurred_at) values(${admin.id},${id},${'feature:'+id},'favourite','favourites','coast',now())`;
 }
 token=(await createApiToken(admin,{name:'Feature fixture',scopes:['catalogue:read','collection:read','relationships:write']})).token;
});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1')await closeDb();});
run('legacy enabled/disabled flags migrate once and preserve explicit new choices',async()=>{
 const sql=getSql(),migration=(await Bun.file('drizzle/0038_split_experimental_features.sql').text()).split('--> statement-breakpoint')[0];
 for(const enabled of [false,true]){
  await sql`insert into system_settings(key,value) values('coast',${{experimentalFeatures:enabled,siteAccess:'public-profiles'}}::jsonb) on conflict(key) do update set value=excluded.value`;
  await sql.unsafe(migration);
  const [row]=await sql`select value from system_settings where key='coast'`;
  expect(row.value.experimentalFeatures).toBeUndefined();
  for(const flag of ['experimentalMusic','experimentalGaming','experimentalParties'])expect(row.value[flag]).toBe(enabled);
  expect(row.value.siteAccess).toBe('public-profiles');
 }
 await sql`update system_settings set value=${{experimentalFeatures:true,experimentalMusic:false}}::jsonb where key='coast'`;
 await sql.unsafe(migration);
 expect((await getConfig()).experimentalMusic).toBe(false);
 expect((await getConfig()).experimentalParties).toBe(true);
 await updateConfig(admin,defaultConfig);
});
run('independent gates filter Collection, lists, activity and public catalogue before counts',async()=>{
 for(const [music,gaming] of [[false,false],[true,false],[false,true],[true,true]]){
  await updateConfig(admin,{experimentalMusic:music,experimentalGaming:gaming,experimentalParties:false});
  const expected=[movie,...gaming?[game]:[],...music?[track]:[]].sort();
  const collection=await collectionData(admin.id,{category:'all'});
  expect(collection.total).toBe(expected.length);expect(collection.assessments.map(a=>a.id).sort()).toEqual(expected);
  const list=await listsData(admin.id,{view:'favourites'});expect(list.total).toBe(expected.length);
  const feed=await activityFeed(admin.id);expect([...new Set(feed.events.map(i=>i.workId))].sort()).toEqual(expected);
  const request=new Request('http://fixture/api/public/v1/catalogue',{headers:{authorization:`Bearer ${token}`}});
  const response=await publicApiHandler({request,url:new URL(request.url),params:{path:'catalogue'}} as Parameters<typeof publicApiHandler>[0]);
  expect(response.status).toBe(200);const data=await response.json();expect(data.pagination.total).toBe(expected.length);expect(data.items.map((i:{id:string})=>i.id).sort()).toEqual(expected);
 }
});
run('Parties work while both media experiments stay off; toggling preserves their data',async()=>{
 await updateConfig(admin,{experimentalMusic:false,experimentalGaming:false,experimentalParties:true});
 const room=await createRoom(admin.id,{});expect(room.hostId).toBe(admin.id);
 await leaveRoom(admin.id,room.id);
 await updateConfig(admin,{experimentalParties:false,experimentalMusic:true});
 await expect(createRoom(admin.id,{})).rejects.toThrow('disabled');
 expect((await getConfig()).experimentalGaming).toBe(false);
 expect((await collectionData(admin.id,{category:'music'})).total).toBe(1);
 await expect(collectionData(admin.id,{category:'game'})).rejects.toThrow('disabled');
});
