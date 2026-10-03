import {beforeAll,afterAll,test,expect} from 'bun:test';
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
 await updateConfig(admin,{experimentalFeatures:true});
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
 await updateConfig(admin,{allowPlaybackSharing:true,experimentalFeatures:false});
 const token='t'.repeat(43);await link(token,true);
 await expect(claimShare({token},null)).rejects.toThrow('disabled');
 const solo='s'.repeat(43);await link(solo);expect((await claimShare({token:solo},null)).token).toHaveLength(43);
 await updateConfig(admin,{experimentalFeatures:true});const grant=await claimShare({token},null);
 await updateConfig(admin,{experimentalFeatures:false});await expect(sharedState(grant.token)).rejects.toThrow('disabled');
 await updateConfig(admin,{experimentalFeatures:true});
});
run('ordinary preferences cannot grant playback sharing; administrator can',async()=>{
 const user={...admin,id:otherId,role:'user' as const};await updateUserSettings(user,{allowPlaybackSharing:true});
 const [before]=await getSql()`select settings from users where id=${otherId}`;expect(before.settings.allowPlaybackSharing).not.toBe(true);
 await updateUser(admin,otherId,{allowPlaybackSharing:true});const [after]=await getSql()`select settings from users where id=${otherId}`;expect(after.settings.allowPlaybackSharing).toBe(true);
});
run('experiments are independent and recommendations use direct evidence without personal writes',async()=>{
 expect((await getConfig()).experimentalRecommendations).toBe(false);
 await expect(experimentalRows(ownerId,'recommendations',new URL('http://fixture.test'))).rejects.toThrow('disabled');
 await updateConfig(admin,{experimentalRecommendations:true});await getSql()`insert into tracking_state(user_id,media_id,watched) values(${ownerId},${seed},true)`;
 const result=await experimentalRows(ownerId,'recommendations',new URL('http://fixture.test'));expect(result.items.map(item=>item.id)).toContain(movie);expect(result.items[0].captionSubtitle).toContain('Evidence');
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
 await updateConfig(admin,{experimentalDynamicForYou:true,experimentalFeatures:true,experimentalRecommendations:false});const db=getSql(),game=crypto.randomUUID(),candidate=crypto.randomUUID(),track=crypto.randomUUID();
 await db`insert into games(id,title,genres) values(${game},'Played',ARRAY['Adventure','Action','Strategy','Puzzle']),(${candidate},'New game',ARRAY['Adventure'])`;
 await db`insert into game_playthroughs(user_id,game_id,status) values(${ownerId},${game},'in-progress')`;
 await db`insert into works(id,category,kind) values(${track},'music','track')`;
 await db`insert into music_works(id,title,kind,genres) values(${track},'Music','track',ARRAY['Ambient','Electronic'])`;
 await db`insert into music_progress(user_id,track_id,play_count) values(${ownerId},${track},1)`;
 const first=await dynamicFeed(ownerId,new URL('http://fixture.test'));
 expect(first.rows).toHaveLength(3);expect(first.nextOffset).toBe(3);expect(first.rows.map(row=>row.category)).toContain('game');expect(first.rows.map(row=>row.category)).toContain('music');
 const second=await dynamicFeed(ownerId,new URL('http://fixture.test?offset=3'));
 const keys=new Set(first.rows.map(row=>row.key));expect(second.rows.some(row=>keys.has(row.key))).toBe(false);
 const row=await experimentalRows(ownerId,'row',new URL('http://fixture.test?category=game&genre=Adventure'));expect(row.items.map(item=>item.id)).toContain(candidate);expect(row.items.map(item=>item.id)).not.toContain(game);
 await updateConfig(admin,{experimentalDynamicForYou:false});await expect(dynamicFeed(ownerId,new URL('http://fixture.test'))).rejects.toThrow('disabled');await expect(experimentalRows(ownerId,'row',new URL('http://fixture.test?category=game&genre=Adventure'))).rejects.toThrow('disabled');
});
run('music recommendation explanations use the shared work ID despite provider IDs',async()=>{
 await updateConfig(admin,{experimentalDynamicForYou:true,experimentalFeatures:true});const album=crypto.randomUUID(),db=getSql();
 await db`insert into works(id,category,kind) values(${album},'music','album')`;
 await db`insert into music_works(id,title,kind,genres) values(${album},'Recommended album','album',ARRAY['Ambient'])`;
 await db`insert into provider_items(instance_id,media_id,external_id,kind) values(${instance},${album},'remote-album','album')`;
 const rows=await experimentalRows(ownerId,'row',new URL('http://fixture.test?category=music&genre=Ambient'));
 const item=rows.items.find(item=>'workId' in item&&item.workId===album);expect(item?.id).toBe('remote-album');expect(item?.captionSubtitle).toBe('Shared genres with Music');
 const plan=await createPlan(ownerId,{workId:album,startsAt:new Date(Date.now()+3600000).toISOString()});
 const planned=await planningData(ownerId,new URL('http://fixture.test'));
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
