import {beforeAll,afterAll,test,expect,spyOn} from 'bun:test';
import {getSql,closeDb} from '../src/lib/server/db';
import {getConfig} from '../src/lib/server/config';
import {updateConfig} from '../src/lib/application/configuration.server';
import {hashToken,updateUser,updateUserSettings} from '../src/lib/server/auth';
import {claimShare,sharedState,sharedProgress,revokeShare} from '../src/lib/sharing/service.server';
import {progressPlayback} from '../src/lib/playback/server';
import {dynamicFeed} from '../src/lib/experiments/dynamic.server';
import {experimentalRows} from '../src/lib/experiments/recommendations.server';
import {createPlan,planningData,cancelPlan,completePlan} from '../src/lib/experiments/planning.server';
import {provisionPolicy} from '../src/lib/providers/jellyfin/provisioning.server';
import {refreshProviderRecommendations} from '../src/lib/experiments/provider-recommendations.server';
import {TraktAdapter} from '../src/lib/providers/trakt/adapter.server';
import {encryptCredential} from '../src/lib/server/security/credentials';
import type {OutboxAction} from '../src/lib/server/queue';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const ownerId=crypto.randomUUID(),otherId=crypto.randomUUID(),movie=crypto.randomUUID(),seed=crypto.randomUUID(),instance=crypto.randomUUID(),connection=crypto.randomUUID(),generation=crypto.randomUUID(),providerItem=crypto.randomUUID();
const admin={id:ownerId,username:'invites-admin',role:'admin' as const,email:null,settings:{}};
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getSql();await db`insert into users(id,username,role) values(${ownerId},'invites-admin','admin'),(${otherId},'invites-other','user')`;
 await db`insert into media(id,kind,title,genres) values(${movie},'movie','Candidate',ARRAY['Drama']),(${seed},'movie','Evidence',ARRAY['Drama'])`;
 await db`insert into provider_instances(id,provider,name,base_url,server_identity) values(${instance},'jellyfin','Fixture','https://fixture.invalid','fixture')`;
 await db`insert into provider_connections(id,user_id,instance_id,status,account_generation) values(${connection},${ownerId},${instance},'connected',${generation})`;
 await db`insert into provider_items(id,instance_id,media_id,external_id,kind) values(${providerItem},${instance},${movie},'item','movie')`;
 await db`insert into availability(user_id,connection_id,media_id,provider_item_id) values(${ownerId},${connection},${movie},${providerItem})`;
});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1')await closeDb();});
async function link(token:string,together=false){const [row]=await getSql()`insert into playback_shares(owner_id,work_id,connection_id,account_generation,token_hash,together,expires_at) values(${ownerId},${movie},${connection},${generation},${await hashToken(token)},${together},now()+interval '1 hour') returning id`;return row.id as string;}
run('single-use share claims are atomic; owner claims and revocation remain isolated',async()=>{
 await updateConfig(admin,{allowPlaybackSharing:true});const token='a'.repeat(43),id=await link(token);
 const attempts=await Promise.allSettled([claimShare({token},null),claimShare({token},null)]);
 expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const grant=(attempts.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof claimShare>>>).value;
 expect((await sharedState(grant.token)).host).toBe(false);
 expect((await claimShare({token},null,grant.token)).token).toBe(grant.token);
 await expect(claimShare({id},{...admin,id:otherId,role:'user'})).rejects.toThrow('unavailable');
 const host=await claimShare({id},admin);expect((await sharedState(host.token)).host).toBe(true);
 await revokeShare(admin,id);await expect(sharedState(grant.token)).rejects.toThrow('revoked');
});
run('expired links, account replacement and policy changes invalidate grants',async()=>{
 for(const mode of ['expiry','generation','policy']){
  await updateConfig(admin,{allowPlaybackSharing:true});const token=(mode[0]).repeat(43),id=await link(token),grant=await claimShare({token},null);
  if(mode==='expiry')await getSql()`update playback_shares set expires_at=now()-interval '1 second' where id=${id}`;
  if(mode==='generation')await getSql()`update provider_connections set account_generation=${crypto.randomUUID()} where id=${connection}`;
  if(mode==='policy')await updateConfig(admin,{allowPlaybackSharing:false});
  await expect(sharedState(grant.token)).rejects.toThrow();
  await getSql()`update provider_connections set account_generation=${generation} where id=${connection}`;
 }
});
run('guest progress cannot alter owner history or another viewer session',async()=>{
 await updateConfig(admin,{experimentalMusic:true,experimentalGaming:true,experimentalParties:true});
 await updateConfig(admin,{allowPlaybackSharing:true});const token='x'.repeat(43),id=await link(token,true),grant=await claimShare({token},null),host=await claimShare({id},admin);
 const playback=crypto.randomUUID();await getSql()`insert into playback_sessions(id,user_id,media_id,share_id,connection_id,provider_item_id,source_id,delivery,stream_path,duration_seconds,expires_at) values(${playback},${ownerId},${movie},${id},${connection},${providerItem},'source','direct','/stream',120,now()+interval '1 hour')`;
 await getSql()`update share_viewers set playback_id=${playback} where token_hash=${await hashToken(grant.token)}`;
 await sharedProgress(grant.token,playback,{event:'progress',positionSeconds:70,paused:false});
 const [events]=await getSql()`select count(*)::int as total from tracking_events where user_id=${ownerId}`;expect(events.total).toBe(0);
 expect((await sharedState(host.token)).positionSeconds).toBe(0);
 await expect(sharedProgress(host.token,playback,{event:'ended',positionSeconds:120})).rejects.toThrow('another viewer');
 await expect(progressPlayback(ownerId,playback,{event:'start',positionSeconds:0})).rejects.toThrow('expired');
});
run('together links follow the synced playback gate while solo invitations remain available',async()=>{
 await updateConfig(admin,{allowPlaybackSharing:true,experimentalMusic:false,experimentalGaming:false,experimentalParties:false});
 const token='t'.repeat(43);await link(token,true);
 await expect(claimShare({token},null)).rejects.toThrow('disabled');
 const solo='s'.repeat(43);await link(solo);expect((await claimShare({token:solo},null)).token).toHaveLength(43);
 await updateConfig(admin,{experimentalMusic:true,experimentalGaming:true,experimentalParties:true});const grant=await claimShare({token},null);
 await updateConfig(admin,{experimentalMusic:false,experimentalGaming:false,experimentalParties:false});await expect(sharedState(grant.token)).rejects.toThrow('disabled');
 await updateConfig(admin,{experimentalMusic:true,experimentalGaming:true,experimentalParties:true});
});
run('ordinary preferences cannot grant playback sharing; administrator can',async()=>{
 const user={...admin,id:otherId,role:'user' as const};await updateUserSettings(user,{allowPlaybackSharing:true});
 const [before]=await getSql()`select settings from users where id=${otherId}`;expect(before.settings.allowPlaybackSharing).not.toBe(true);
 await updateUser(admin,otherId,{allowPlaybackSharing:true});const [after]=await getSql()`select settings from users where id=${otherId}`;expect(after.settings.allowPlaybackSharing).toBe(true);
});
run('recommendations are standard features even with obsolete disabled flags saved, and never write personal state',async()=>{
 await getSql()`update system_settings set value=value || ${{experimentalDynamicForYou:false,experimentalRecommendations:false}}::jsonb where key='coast'`;
 expect(await getConfig()).not.toHaveProperty('experimentalDynamicForYou');
 expect(await getConfig()).not.toHaveProperty('experimentalRecommendations');
 await expect(experimentalRows(ownerId,'unknown',new URL('http://fixture.test'))).rejects.toThrow('Unknown recommendation source');
 await getSql()`insert into tracking_state(user_id,media_id,watched) values(${ownerId},${seed},true)`;
 const result=await experimentalRows(ownerId,'recommendations',new URL('http://fixture.test'));expect(result.items.map(item=>item.id)).toContain(movie);expect(result.items[0].captionSubtitle??'').not.toContain('Shared genres with');
 expect((await dynamicFeed(ownerId,new URL('http://fixture.test'))).rows.length).toBeGreaterThan(0);
 expect((await getConfig()).experimentalPlanning).toBe(false);
 const [personal]=await getSql()`select count(*)::int as total from tracking_state where user_id=${ownerId} and media_id=${movie}`;expect(personal.total).toBe(0);
});
run('planning queues a bounded reminder, separates completion/cancellation and rejects another owner',async()=>{
 await updateConfig(admin,{experimentalPlanning:true});const startsAt=new Date(Date.now()+3600000).toISOString();
 const plan=await createPlan(ownerId,{workId:movie,startsAt});const data=await planningData(ownerId,new URL('http://fixture.test'));expect(data.total).toBe(1);
 const [job]=await getSql()`select next_attempt_at from outbox_actions where kind='planning.reminder' and payload->>'planId'=${plan.id}`;expect(Math.abs(new Date(job.next_attempt_at).getTime()-(Date.parse(startsAt)-900000))).toBeLessThan(1000);
 await expect(cancelPlan(otherId,plan.id)).rejects.toThrow('not found');await completePlan(ownerId,plan.id);expect((await planningData(ownerId,new URL('http://fixture.test'))).total).toBe(0);
 const releases=await planningData(ownerId,new URL('http://fixture.test?view=releases'));expect(releases.total).toBe(0);
});
run('Upcoming follows watchlist and tracked shows without requiring unreleased Collection membership',async()=>{
 await updateConfig(admin,{experimentalPlanning:true});const db=getSql(),show=crypto.randomUUID(),episode=crypto.randomUUID();
 await db`update media set release_date=current_date+7 where id=${movie}`;
 await db`insert into media(id,kind,title) values(${show},'show','Tracked show')`;
 await db`insert into shows(media_id) values(${show})`;
 await db`insert into media(id,kind,title,release_date) values(${episode},'episode','Future episode',current_date+8)`;
 await db`insert into episodes(media_id,show_id,season_number,episode_number) values(${episode},${show},1,1)`;
 expect((await planningData(ownerId,new URL('http://fixture.test?view=releases'))).total).toBe(0);
 await db`insert into tracking_state(user_id,media_id,watchlist) values(${ownerId},${movie},true) on conflict(user_id,media_id) do update set watchlist=true`;
 await db`insert into tracking_state(user_id,media_id,completed_episodes) values(${ownerId},${show},1)`;
 const upcoming=await planningData(ownerId,new URL('http://fixture.test?view=releases'));expect(upcoming.total).toBe(2);expect(upcoming.items.map(item=>item.id)).toEqual([movie,episode]);
 expect((await planningData(otherId,new URL('http://fixture.test?view=releases'))).total).toBe(0);
 await db`update tracking_state set dropped=true where user_id=${ownerId} and media_id=${show}`;
 expect((await planningData(ownerId,new URL('http://fixture.test?view=releases'))).total).toBe(1);
 await db`update media set release_date=null where id=${movie}`;
});
run('Dynamic For You pages distinct horizontal row definitions and loads cards separately',async()=>{
 await updateConfig(admin,{experimentalMusic:true,experimentalGaming:true,experimentalParties:true});const db=getSql(),game=crypto.randomUUID(),candidate=crypto.randomUUID(),track=crypto.randomUUID();
 await db`insert into games(id,title,genres) values(${game},'Played',ARRAY['Adventure','Action','Strategy','Puzzle']),(${candidate},'New game',ARRAY['Adventure'])`;
 await db`insert into game_playthroughs(user_id,game_id,status) values(${ownerId},${game},'in-progress')`;
 await db`insert into works(id,category,kind) values(${track},'music','track')`;
 await db`insert into music_works(id,title,kind,genres) values(${track},'Music','track',ARRAY['Ambient','Electronic'])`;
 await db`insert into music_progress(user_id,track_id,play_count) values(${ownerId},${track},1)`;
 const first=await dynamicFeed(ownerId,new URL('http://fixture.test'));
 expect(first.rows).toHaveLength(3);expect(first.nextOffset).toBe(3);
 const single=await dynamicFeed(ownerId,new URL('http://fixture.test?limit=1'));
 expect(single.rows.map(row=>row.key)).toEqual(first.rows.slice(0,1).map(row=>row.key));expect(single.nextOffset).toBe(1);
 const nextSingle=await dynamicFeed(ownerId,new URL('http://fixture.test?limit=1&offset=1'));
 expect(nextSingle.rows.map(row=>row.key)).toEqual(first.rows.slice(1,2).map(row=>row.key));
 const second=await dynamicFeed(ownerId,new URL('http://fixture.test?offset=3'));
 const keys=new Set(first.rows.map(row=>row.key));expect(second.rows.some(row=>keys.has(row.key))).toBe(false);
 async function allRows(seed:string){
  const rows:Awaited<ReturnType<typeof dynamicFeed>>['rows']=[];
  let offset:number|null=0;
  while(offset!==null){const batch=await dynamicFeed(ownerId,new URL(`http://fixture.test?seed=${seed}&offset=${offset}`));rows.push(...batch.rows);offset=batch.nextOffset;}
  return rows;
 }
 const orderA=await allRows('00000000-0000-4000-8000-000000000001'),orderB=await allRows('00000000-0000-4000-8000-000000000002');
 expect(orderA.map(row=>row.key)).toEqual((await allRows('00000000-0000-4000-8000-000000000001')).map(row=>row.key));
 expect(orderA.map(row=>row.key)).not.toEqual(orderB.map(row=>row.key));
 expect(orderA.map(row=>row.key).sort()).toEqual(orderB.map(row=>row.key).sort());
 expect(new Set(orderA.map(row=>row.key)).size).toBe(orderA.length);
 expect((await allRows('lan-http-seed')).map(row=>row.key).sort()).toEqual(orderA.map(row=>row.key).sort());
 expect(orderA.filter(row=>row.surface==='popular').map(row=>row.category).sort()).toEqual(['game','music','screen']);
 const personalised=await allRows('00000000-0000-4000-8000-000000000001');
 expect(personalised.filter(row=>row.surface==='recommendations').map(row=>row.category).sort()).toEqual(['game','music','screen']);
 expect(personalised.map(row=>row.key)).toEqual((await allRows('00000000-0000-4000-8000-000000000001')).map(row=>row.key));
 for(const row of personalised.filter(row=>row.surface==='recommendations')){
  const grid=await experimentalRows(ownerId,'recommendations',new URL(`http://fixture.test?category=${row.category}&seed=00000000-0000-4000-8000-000000000001`));
  expect(grid.title).toBe(row.title);
  if(row.category==='game'){expect(grid.items.map(item=>item.id)).toContain(candidate);expect(grid.items.map(item=>item.id)).not.toContain(game);}
 }
 const dramaRows=orderA.filter(row=>row.surface==='genre'&&row.category==='screen'&&row.genre==='Drama');
 expect(dramaRows).toHaveLength(2);
 for(const row of dramaRows){if(row.surface!=='genre')continue;const grid=await experimentalRows(ownerId,'row',new URL(`http://fixture.test?category=${row.category}&genre=${row.genre}&kind=${row.kind}&reason=${row.reason}&seed=00000000-0000-4000-8000-000000000001`));expect(grid.title).toBe(row.title);expect(row.title.toLowerCase()).toContain('drama');}
 const show=crypto.randomUUID(),freshMovie=crypto.randomUUID();
 await db`insert into media(id,kind,title,genres) values(${show},'show','Drama show',ARRAY['Drama']),(${freshMovie},'movie','Drama movie',ARRAY['Drama'])`;
 const movies=await experimentalRows(ownerId,'row',new URL('http://fixture.test?category=screen&genre=Drama&kind=movie'));
 const shows=await experimentalRows(ownerId,'row',new URL('http://fixture.test?category=screen&genre=Drama&kind=show'));
 expect(movies.items.map(item=>item.id)).toContain(freshMovie);expect(movies.items.map(item=>item.id)).not.toContain(show);
 expect(shows.items.map(item=>item.id)).toContain(show);expect(shows.items.map(item=>item.id)).not.toContain(freshMovie);
 const personalRow=orderA.find(row=>row.surface==='seed'&&row.workId===game);
 expect(personalRow?.title).toContain('Played');
 const linked=await experimentalRows(ownerId,'row',new URL(`http://fixture.test?category=game&work=${game}&seed=00000000-0000-4000-8000-000000000001`));
 expect(linked.title).toBe(personalRow?.title);
 expect(linked.items.map(item=>item.id)).toContain(candidate);
 expect(linked.items.map(item=>item.id)).not.toContain(game);
 const unrelated=await experimentalRows(otherId,'row',new URL(`http://fixture.test?category=game&work=${game}`));
 expect(unrelated.items).toHaveLength(0);
 await updateConfig(admin,{experimentalMusic:false,experimentalGaming:false});
 const watchOnly=await allRows('00000000-0000-4000-8000-000000000001');
 expect(watchOnly.filter(row=>row.surface==='popular').map(row=>row.category)).toEqual(['screen']);
 expect(watchOnly.every(row=>row.category==='screen')).toBe(true);
 await updateConfig(admin,{experimentalMusic:true,experimentalGaming:true});
 const row=await experimentalRows(ownerId,'row',new URL('http://fixture.test?category=game&genre=Adventure'));expect(row.items.map(item=>item.id)).toContain(candidate);expect(row.items.map(item=>item.id)).not.toContain(game);
 for(let index=0;index<8;index++)await db`insert into games(id,title,genres) values(${crypto.randomUUID()},${`Genre candidate ${index}`},ARRAY['Adventure','Action'])`;
 const genreRows=(genre:string,seed:string)=>experimentalRows(ownerId,'row',new URL(`http://fixture.test?category=game&genre=${genre}&seed=${seed}`));
 const adventure=await genreRows('Adventure','visit-a'),again=await genreRows('Adventure','visit-a'),anotherVisit=await genreRows('Adventure','visit-b'),action=await genreRows('Action','visit-a');
 expect(adventure.items.map(item=>item.id)).toEqual(again.items.map(item=>item.id));
 expect(adventure.items.map(item=>item.id)).not.toEqual(anotherVisit.items.map(item=>item.id));
 expect(adventure.items.map(item=>item.id).sort()).toEqual(anotherVisit.items.map(item=>item.id).sort());
 expect(adventure.items.filter(item=>item.id!==candidate).map(item=>item.id)).not.toEqual(action.items.map(item=>item.id));
 expect((await dynamicFeed(ownerId,new URL('http://fixture.test'))).rows.length).toBeGreaterThan(0);
});
run('music recommendations preserve shared identity and avoid repeated explanation captions',async()=>{
 await updateConfig(admin,{experimentalMusic:true,experimentalGaming:true,experimentalParties:true});const album=crypto.randomUUID(),db=getSql();
 await db`insert into works(id,category,kind) values(${album},'music','album')`;
 await db`insert into music_works(id,title,kind,genres) values(${album},'Recommended album','album',ARRAY['Ambient'])`;
 await db`insert into provider_items(instance_id,media_id,external_id,kind) values(${instance},${album},'remote-album','album')`;
 const rows=await experimentalRows(ownerId,'row',new URL('http://fixture.test?category=music&genre=Ambient'));
 const item=rows.items.find(item=>'workId' in item&&item.workId===album);expect(item?.id).toBe('remote-album');expect(item?.captionSubtitle??'').not.toContain('Shared genres with');
 const plan=await createPlan(ownerId,{workId:album,startsAt:new Date(Date.now()+3600000).toISOString()});
 const planned=await planningData(ownerId,new URL('http://fixture.test?category=music'));
 expect((await planningData(ownerId,new URL('http://fixture.test?category=screen'))).plans.some(row=>row.id===plan.id)).toBe(false);
 expect(planned.items.find(item=>item.entryId===plan.id)?.id).toBe('remote-album');
 await completePlan(ownerId,plan.id);
});
run('overdue scheduled plans still count toward the plan limit',async()=>{
 const db=getSql();await db`insert into media_plans(user_id,work_id,starts_at) select ${otherId}::uuid,${movie}::uuid,now()-interval '1 day' from generate_series(1,100)`;
 await expect(createPlan(otherId,{workId:movie,startsAt:new Date(Date.now()+3600000).toISOString()})).rejects.toThrow('Complete or cancel');
});
run('provisioning uses an explicit non-admin library policy',()=>{
 const policy=provisionPolicy({IsAdministrator:true,EnableAllFolders:true,EnableContentDownloading:true},['permitted']);expect(policy.IsAdministrator).toBe(false);expect(policy.EnableAllFolders).toBe(false);expect(policy.EnabledFolders).toEqual(['permitted']);expect(policy.EnablePublicSharing).toBe(false);expect(policy.EnableContentDownloading).toBe(false);
});

run('provider suggestions work without genre overlap and remain account-generation scoped',async()=>{
 await updateConfig(admin,{enableTrakt:true});
 const db=getSql(),service=crypto.randomUUID(),personal=crypto.randomUUID(),suggestion=crypto.randomUUID(),privateSuggestion=crypto.randomUUID(),account=crypto.randomUUID(),accountGeneration=crypto.randomUUID();
 await db`insert into provider_instances(id,provider,name,base_url,credentials) values(${service},'trakt','Suggestion fixture','https://fixture.invalid','fixture')`;
 await db`insert into provider_connections(id,user_id,instance_id,status,account_generation) values(${account},${otherId},${service},'connected',${accountGeneration})`;
 await db`insert into media(id,kind,title,genres) values(${personal},'movie','Liked seed',ARRAY['Comedy']),(${suggestion},'movie','Provider suggestion',ARRAY['Mystery']),(${privateSuggestion},'movie','Private suggestion',ARRAY['Western'])`;
 await db`insert into tracking_state(user_id,media_id,favourite) values(${ownerId},${personal},true)`;
 await db`insert into recommendation_sets(instance_id,key,seed_id,items) values(${service},'shared',${personal},${db.array([suggestion],'UUID')})`;
 await db`insert into recommendation_sets(instance_id,key,connection_id,account_generation,items) values(${service},'account:movie',${account},${accountGeneration},${db.array([privateSuggestion],'UUID')})`;
 const linked=await experimentalRows(ownerId,'row',new URL(`http://fixture.test?category=screen&work=${personal}`));
 expect(linked.items.map(item=>item.id)).toContain(suggestion);expect(linked.items.map(item=>item.id)).not.toContain(privateSuggestion);
 expect((await experimentalRows(ownerId,'recommendations',new URL('http://fixture.test'))).items.map(item=>item.id)).not.toContain(privateSuggestion);
 expect((await experimentalRows(otherId,'recommendations',new URL('http://fixture.test'))).items.map(item=>item.id)).toContain(privateSuggestion);
 await db`update provider_connections set account_generation=${crypto.randomUUID()} where id=${account}`;
 expect((await experimentalRows(otherId,'recommendations',new URL('http://fixture.test'))).items.map(item=>item.id)).not.toContain(privateSuggestion);
 await db`insert into ratings(user_id,media_id,value) values(${ownerId},${suggestion},1)`;
 expect((await experimentalRows(ownerId,'row',new URL(`http://fixture.test?category=screen&work=${personal}`))).items.map(item=>item.id)).not.toContain(suggestion);
});
run('Trakt refreshes retain separate recommendation sets for every connected account',async()=>{
 await updateConfig(admin,{enableTrakt:true});
 const db=getSql(),service=crypto.randomUUID(),accounts=[crypto.randomUUID(),crypto.randomUUID()],generations=[crypto.randomUUID(),crypto.randomUUID()];
 const app=await encryptCredential(JSON.stringify({clientId:'fixture',clientSecret:'fixture'}));
 const credentials=await encryptCredential(JSON.stringify({access_token:'fixture',refresh_token:'fixture',created_at:Math.floor(Date.now()/1000),expires_in:3600}));
 await db`insert into provider_instances(id,provider,name,base_url,credentials) values(${service},'trakt','Two accounts','https://api.trakt.tv',${app})`;
 for(const [index,userId] of [ownerId,otherId].entries())await db`insert into provider_connections(id,user_id,instance_id,status,account_generation,credentials) values(${accounts[index]},${userId},${service},'connected',${generations[index]},${credentials})`;
 const action=(index:number):OutboxAction=>({id:crypto.randomUUID(),userId:[ownerId,otherId][index],connectionId:accounts[index],accountGeneration:generations[index],kind:'trakt.recommendations',payload:{instanceId:service},attempts:0,correlationId:crypto.randomUUID()});
 const recommendations=spyOn(TraktAdapter.prototype,'recommendations').mockResolvedValue([]);
 try{
  for(const index of [0,1,0])expect(await refreshProviderRecommendations(action(index))).toEqual({checked:2,added:0});
  const sets=await db<{connection_id:string;account_generation:string;key:string}[]>`select connection_id,account_generation,key from recommendation_sets where instance_id=${service}`;
  expect(sets).toHaveLength(4);
  for(const [index,account] of accounts.entries()){
   const own=sets.filter(set=>set.connection_id===account);
   expect(own).toHaveLength(2);expect(own.every(set=>set.account_generation===generations[index])).toBe(true);
  }
  generations[0]=crypto.randomUUID();await db`update provider_connections set account_generation=${generations[0]} where id=${accounts[0]}`;
  await refreshProviderRecommendations(action(0));
  const refreshed=await db<{connection_id:string;account_generation:string}[]>`select connection_id,account_generation from recommendation_sets where instance_id=${service}`;
  expect(refreshed).toHaveLength(4);
  expect(refreshed.filter(set=>set.connection_id===accounts[0]).every(set=>set.account_generation===generations[0])).toBe(true);
  expect(refreshed.filter(set=>set.connection_id===accounts[1]).every(set=>set.account_generation===generations[1])).toBe(true);
  await db`insert into recommendation_sets(instance_id,key,connection_id,account_generation,items) values(${service},'account:movie',${accounts[0]},${generations[0]},'{}'),(${service},'account:show',${accounts[1]},${generations[1]},'{}'),(${service},'shared',null,null,'{}')`;
  await db.unsafe(await Bun.file(new URL('../drizzle/0043_trakt_recommendation_accounts.sql',import.meta.url)).text());
  const migrated=await db<{key:string}[]>`select key from recommendation_sets where instance_id=${service}`;
  expect(migrated.map(set=>set.key).sort()).toEqual([...sets.map(set=>set.key),'shared'].sort());
 }finally{recommendations.mockRestore();}
});
run('negative interests do not produce fan rows and saved-only evidence never claims enjoyment',async()=>{
 const db=getSql(),dropped=crypto.randomUUID(),saved=crypto.randomUUID();
 await db`insert into media(id,kind,title,genres) values(${dropped},'movie','Dropped',ARRAY['Unique disliked genre']),(${saved},'movie','Saved',ARRAY['Unique saved genre'])`;
 await db`insert into tracking_state(user_id,media_id,dropped,watchlist) values(${otherId},${dropped},true,false),(${otherId},${saved},false,true)`;
 let offset:number|null=0;const rows:Awaited<ReturnType<typeof dynamicFeed>>['rows']=[];
 while(offset!==null){const page=await dynamicFeed(otherId,new URL(`http://fixture.test?offset=${offset}&seed=taste`));rows.push(...page.rows);offset=page.nextOffset;}
 expect(rows.some(row=>row.surface==='genre'&&row.genre==='Unique disliked genre')).toBe(false);
 const savedRows=rows.filter(row=>row.surface==='genre'&&row.genre==='Unique saved genre');expect(savedRows).toHaveLength(2);expect(savedRows.every(row=>row.surface==='genre'&&row.reason==='saved')).toBe(true);expect(savedRows.some(row=>row.title.includes('love'))).toBe(false);
});
