import {presence} from '../src/lib/social/presence.server';
import {enqueueAction,runQueueOnce,registerActionHandler} from '../src/lib/server/queue';
import {encryptCredential} from '../src/lib/server/security/credentials';
import {beforeAll,afterAll,expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import { getConfig, type CoastConfig } from '../src/lib/server/config';
import { updateConfig } from '../src/lib/application/configuration.server';
import {createInvite,registerAccount,onboardingPending,onboardingStatus,revokeInvite,retryOnboarding,beginOnboardingImports} from '../src/lib/server/auth/onboarding';
import {createRoom,inviteParticipant,joinRoom,roomState,commandRoom,leaveRoom,declineInvitation,listRooms} from '../src/lib/playback/synced/service.server';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const ids=Array.from({length:3},()=>crypto.randomUUID()),instance=crypto.randomUUID(),work=crypto.randomUUID();
const musicIds=[crypto.randomUUID(),crypto.randomUUID()];
const conn=ids.map(()=>crypto.randomUUID()),play=ids.map(()=>crypto.randomUUID());
const admin={id:ids[0],username:'sync-host',role:'admin' as const,email:null,settings:{}};
let config:CoastConfig;const extra:string[]=[];
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;config=await getConfig();
 for(const [i,id]of ids.entries())await getSql()`INSERT INTO users (id,username,role) VALUES (${id},${`sync-${id}`},${i===0?'admin':'user'})`;
 await updateConfig(admin,{experimentalMusic:true,experimentalGaming:true,experimentalParties:true});
 await getSql()`INSERT INTO works (id,category,kind) VALUES (${work},'screen','movie')`;
 await getSql()`INSERT INTO provider_instances (id,provider,name,base_url,server_identity) VALUES (${instance},'jellyfin','Sync fixture','https://fixture.invalid','fixture')`;
 for(const [i,id] of conn.entries()){
  await getSql()`INSERT INTO provider_connections (id,user_id,instance_id,status,external_user_id,credentials) VALUES (${id},${ids[i]},${instance},'connected',${ids[i]},${await encryptCredential(JSON.stringify({accessToken:'fixture'}))})`;
  const [p]=await getSql()`INSERT INTO provider_items (instance_id,external_id,media_id,kind) VALUES (${instance},${ids[i]},${work},'movie') RETURNING id`;
  await getSql()`INSERT INTO playback_sessions (id,user_id,media_id,connection_id,provider_item_id,source_id,delivery,stream_path,duration_seconds,expires_at) VALUES (${play[i]},${ids[i]},${work},${id},${p.id},'source','direct','/stream',120,NOW()+INTERVAL '1 hour')`;
 }
 await getSql()`INSERT INTO friendships (user_a,user_b,requested_by,state) VALUES (least(${ids[0]}::uuid,${ids[1]}::uuid),greatest(${ids[0]}::uuid,${ids[1]}::uuid),${ids[0]},'accepted')`;
});
afterAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;await updateConfig(admin,config);for(const id of [work,...musicIds])await getSql()`DELETE FROM works WHERE id=${id}`;await getSql()`DELETE FROM provider_instances WHERE id=${instance}`;for(const id of [...extra,...ids])await getSql()`DELETE FROM users WHERE id=${id}`;});
run('invites are hashed, single-use under concurrency, and create restricted normal accounts',async()=>{
 const invite=await createInvite(admin,{days:7});
 const [stored]=await getSql()`SELECT token_hash FROM registration_invites WHERE id=${invite.id}`;expect(stored.token_hash).not.toBe(invite.code);
 const attempts=await Promise.allSettled([0,1].map(i=>registerAccount({code:invite.code,username:`invite-${crypto.randomUUID()}`.slice(0,32),displayName:'Fixture user',passwordConfirmation:'A strong fixture password!',password:'A strong fixture password!'},`fixture-${i}`)));
 const accepted=attempts.filter(x=>x.status==='fulfilled');expect(accepted).toHaveLength(1);
 const user=(accepted[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof registerAccount>>>).value.user;extra.push(user.id);expect(user.role).toBe('user');expect(await onboardingPending(user.id)).toBe(true);
 const revoked=await createInvite(admin,{days:1});await revokeInvite(admin,revoked.id);await expect(registerAccount({code:revoked.code,username:'revoked-fixture',displayName:'Fixture user',passwordConfirmation:'A strong fixture password!',password:'A strong fixture password!'},'fixture-revoked')).rejects.toThrow('invalid');
 const expired=await createInvite(admin,{days:1});await getSql()`UPDATE registration_invites SET expires_at=NOW()-INTERVAL '1 second' WHERE id=${expired.id}`;
 await expect(registerAccount({code:expired.code,username:'expired-fixture',displayName:'Fixture user',passwordConfirmation:'A strong fixture password!',password:'A strong fixture password!'},'fixture-expired')).rejects.toThrow('invalid');
});
run('open registration captures policy, validates confirmation, and requires explicit completion',async()=>{
 await updateConfig(admin,{registrationMode:'open',registrationProvider:'none'});
 const input={username:'Open.Fixture',displayName:'Open Fixture',password:'A strong fixture password!',passwordConfirmation:'wrong confirmation'};
 await expect(registerAccount(input,'open-mismatch')).rejects.toThrow('Passwords must match');
 const session=await registerAccount({...input,passwordConfirmation:input.password},'open-success');extra.push(session.user.id);
 expect(session.user.username).toBe('open.fixture');expect(session.user.settings.profile?.displayName).toBe('Open Fixture');
 await updateConfig(admin,{registrationMode:'invite',registrationProvider:'jellyfin'});
 expect((await onboardingStatus(session.user.id)).requiredProvider).toBe('none');
 expect((await onboardingStatus(session.user.id)).complete).toBe(false);
 expect((await beginOnboardingImports(session.user.id)).complete).toBe(true);
 await expect(registerAccount({...input,username:'invite-required',passwordConfirmation:input.password},'open-rejected')).rejects.toThrow('invite');
});
run('required connections cannot be bypassed and a deleted selected account cannot complete',async()=>{
 const invite=await createInvite(admin,{days:1});const session=await registerAccount({code:invite.code,username:'required-fixture',displayName:'Required Fixture',password:'A strong fixture password!',passwordConfirmation:'A strong fixture password!'},'required');extra.push(session.user.id);
 await expect(beginOnboardingImports(session.user.id)).rejects.toThrow('required');
 await getSql()`update user_onboarding set required_provider='none',imports_started_at=now(),account_generation=gen_random_uuid() where user_id=${session.user.id}`;
 const status=await onboardingStatus(session.user.id);expect(status.complete).toBe(false);expect(status.reconnect).toBe(true);
});
run('Trakt onboarding requires both pinned import outcomes and leaves export preferences untouched',async()=>{
 await updateConfig(admin,{registrationMode:'open',registrationProvider:'trakt'});
 const session=await registerAccount({username:'trakt-fixture',displayName:'Trakt Fixture',password:'A strong fixture password!',passwordConfirmation:'A strong fixture password!'},'trakt-onboarding');extra.push(session.user.id);
 const service=crypto.randomUUID(),connection=crypto.randomUUID();
 try{
  await getSql()`insert into provider_instances(id,provider,name,base_url) values(${service},'trakt','Onboarding fixture','https://api.trakt.tv')`;
  const [c]=await getSql()`insert into provider_connections(id,user_id,instance_id,status,external_user_id,settings) values(${connection},${session.user.id},${service},'connected','fixture-account',${{sync:{history:false,lists:false}}}::jsonb) returning account_generation`;
  const jobs:Record<string,string>={};for(const kind of ['trakt.import','trakt.lists-import']){const [job]=await getSql()`insert into outbox_actions(user_id,connection_id,kind,payload,state) values(${session.user.id},${connection},${kind},${{initialImport:true}}::jsonb,'pending') returning id`;jobs[kind]=job.id;}
  await getSql()`update user_onboarding set trakt_connection_id=${connection},trakt_account_generation=${c.account_generation},import_jobs=${jobs}::jsonb where user_id=${session.user.id}`;
  expect((await beginOnboardingImports(session.user.id)).complete).toBe(false);
  await getSql()`update outbox_actions set state='succeeded' where id=${jobs['trakt.import']}`;
  expect((await onboardingStatus(session.user.id)).complete).toBe(false);
  await getSql()`update outbox_actions set state='failed' where id=${jobs['trakt.lists-import']}`;
  expect((await onboardingStatus(session.user.id)).imports.some(i=>i.state==='failed')).toBe(true);
  await getSql()`update outbox_actions set payload=payload||${{_jobFailure:{code:'provider.authentication'}}}::jsonb where id=${jobs['trakt.lists-import']}`;
  const rejected=await onboardingStatus(session.user.id);expect(rejected.reconnect).toBe(true);expect(rejected.traktLinked).toBe(false);
  await getSql()`update outbox_actions set state='succeeded' where id=${jobs['trakt.lists-import']}`;
  const [preferences]=await getSql()`select settings from provider_connections where id=${connection}`;expect(preferences.settings.sync).toEqual({history:false,lists:false});
  await getSql()`update provider_connections set account_generation=gen_random_uuid() where id=${connection}`;
  expect((await onboardingStatus(session.user.id)).complete).toBe(false);
  await getSql()`update user_onboarding set trakt_account_generation=${c.account_generation} where user_id=${session.user.id}`;
  await getSql()`update provider_connections set account_generation=${c.account_generation} where id=${connection}`;
  expect((await onboardingStatus(session.user.id)).complete).toBe(true);
 }finally{await getSql()`delete from provider_instances where id=${service}`;await updateConfig(admin,{registrationMode:'invite',registrationProvider:'jellyfin'});}
});
run('shared scan cannot complete onboarding; fresh current-account user traversal can',async()=>{
 await getSql()`INSERT INTO user_onboarding (user_id,connection_id,account_generation,imports_started_at,requested_at) SELECT ${ids[1]},id,account_generation,NOW(),NOW()-INTERVAL '1 minute' FROM provider_connections WHERE id=${conn[1]}`;
 await getSql()`INSERT INTO sync_checkpoints (connection_id,kind,completed_at) VALUES (${conn[1]},'jellyfin-full',NOW())`;
 expect((await onboardingStatus(ids[1])).complete).toBe(false);
 await getSql()`INSERT INTO sync_checkpoints (connection_id,kind,completed_at) VALUES (${conn[1]},'jellyfin-user',NOW()-INTERVAL '1 hour')`;
 expect((await onboardingStatus(ids[1])).complete).toBe(false);
 await getSql()`UPDATE sync_checkpoints SET completed_at=NOW(),scan_id=gen_random_uuid() WHERE connection_id=${conn[1]} AND kind='jellyfin-user'`;
 expect((await onboardingStatus(ids[1])).complete).toBe(false);
 await getSql()`UPDATE sync_checkpoints SET scan_id=NULL WHERE connection_id=${conn[1]} AND kind='jellyfin-user'`;
 await getSql()`UPDATE user_onboarding SET account_generation=gen_random_uuid() WHERE user_id=${ids[1]}`;
 const switched=await onboardingStatus(ids[1]);expect(switched.complete).toBe(false);expect(switched.reconnect).toBe(true);
 await getSql()`UPDATE user_onboarding o SET account_generation=c.account_generation FROM provider_connections c WHERE o.user_id=${ids[1]} AND c.id=o.connection_id`;
 expect((await onboardingStatus(ids[1])).complete).toBe(true);
});
run('private friend membership, own source, revision control, buffering and revocation',async()=>{
 let r=await createRoom(ids[0],{playbackId:play[0],positionSeconds:20});
 await expect(inviteParticipant(ids[0],r.id,{friendId:ids[2]})).rejects.toThrow('friends');
 await expect(roomState(ids[2],r.id)).rejects.toThrow('not found');
 await getSql()`UPDATE users SET settings=${{social:{audience:'private'}}}::jsonb WHERE id=${ids[0]}`;
 await inviteParticipant(ids[0],r.id,{friendId:ids[1]});
 const [notice]=await getSql()`SELECT social_notification_visible(user_id,kind,data) AS visible,data->>'workId' AS work_id FROM notifications WHERE source_key=${`synced:${r.id}`} AND user_id=${ids[1]}`;expect(notice.visible).toBe(true);expect(notice.work_id).toBe(work);
 await getSql()`UPDATE users SET settings='{}'::jsonb WHERE id=${ids[0]}`;
 await expect(joinRoom(ids[1],r.id,{playbackId:play[0],revision:r.revision})).rejects.toThrow('own');
 await getSql()`UPDATE playback_sessions SET duration_seconds=130 WHERE id=${play[1]}`;
 await expect(joinRoom(ids[1],r.id,{playbackId:play[1],revision:r.revision})).rejects.toThrow('different');
 await getSql()`UPDATE playback_sessions SET duration_seconds=120 WHERE id=${play[1]}`;
 r=await joinRoom(ids[1],r.id,{playbackId:play[1],revision:r.revision});
 await expect(commandRoom(ids[1],r.id,{action:'play',revision:r.revision})).rejects.toThrow('host');
 const old=r.revision;r=await commandRoom(ids[0],r.id,{action:'play',revision:r.revision});
 await expect(commandRoom(ids[0],r.id,{action:'pause',revision:old})).rejects.toThrow('changed');
 r=await roomState(ids[1],r.id,{buffering:true});expect(r.bufferingPaused).toBe(true);
 r=await roomState(ids[1],r.id,{buffering:false});expect(r.bufferingPaused).toBe(false);
 r=await commandRoom(ids[0],r.id,{action:'policy',policy:'catch-up',revision:r.revision});
 r=await roomState(ids[1],r.id,{buffering:true});expect(r.bufferingPaused).toBe(false);
 await getSql()`UPDATE synced_participants SET heartbeat_at=NOW()-INTERVAL '30 seconds' WHERE room_id=${r.id} AND user_id=${ids[0]}`;
 r=await roomState(ids[1],r.id,{buffering:false});expect(r.bufferingPaused).toBe(true);
 r=await roomState(ids[0],r.id,{buffering:false});expect(r.bufferingPaused).toBe(false);
 await getSql()`UPDATE provider_connections SET external_user_id='replacement-account' WHERE id=${conn[1]}`;
 r=await roomState(ids[0],r.id);expect(r.participants.find(p=>p.userId===ids[1])?.joined).toBe(false);
 await leaveRoom(ids[0],r.id);expect((await roomState(ids[0],r.id)).ended).toBe(true);
 await updateConfig(admin,{experimentalMusic:false,experimentalGaming:false,experimentalParties:false});await expect(createRoom(ids[0],{playbackId:play[0],positionSeconds:0})).rejects.toThrow('disabled');await updateConfig(admin,{experimentalMusic:true,experimentalGaming:true,experimentalParties:true});
});

run('music queue keeps gaps, order and repeated track positions',async()=>{
 const playbackIds:string[]=[];
 for(const [i,id]of musicIds.entries()){
  await getSql()`INSERT INTO works (id,category,kind) VALUES (${id},'music','track')`;
  await getSql()`INSERT INTO music_works (id,title,kind,duration_seconds) VALUES (${id},${`Track ${i}`},'track',12)`;
  const [item]=await getSql()`INSERT INTO provider_items (instance_id,external_id,media_id,kind) VALUES (${instance},${id},${id},'track') RETURNING id`;
  const [p]=await getSql()`INSERT INTO playback_sessions (user_id,media_id,media_type,connection_id,provider_item_id,source_id,delivery,stream_path,duration_seconds,expires_at) VALUES (${ids[0]},${id},'audio',${conn[0]},${item.id},'source','direct','/audio',12,NOW()+INTERVAL '1 hour') RETURNING id`;
  playbackIds.push(p.id);
 }
 let r=await createRoom(ids[0],{playbackId:playbackIds[0],positionSeconds:0,queue:[musicIds[0],musicIds[1],musicIds[0]],queueIndex:2});
 expect(r.queueItems.map(i=>i.id)).toEqual([musicIds[0],musicIds[1],musicIds[0]]);expect(r.queueIndex).toBe(2);expect(r.queueItems[1].availability).toBe('unknown');
 r=await commandRoom(ids[0],r.id,{action:'item',revision:r.revision,playbackId:playbackIds[1],queueIndex:1});expect(r.mediaId).toBe(musicIds[1]);expect(r.queueIndex).toBe(1);
 await leaveRoom(ids[0],r.id);
});

run('onboarding ignores obsolete jobs and owner retries respect the service lane',async()=>{
 await getSql()`UPDATE outbox_actions SET state='cancelled' WHERE connection_id=ANY(${getSql().array(conn,'TEXT')}::uuid[]) AND state IN ('pending','running')`;
 await getSql()`INSERT INTO user_onboarding (user_id,connection_id,account_generation,imports_started_at) SELECT ${ids[2]},id,account_generation,NOW() FROM provider_connections WHERE id=${conn[2]}`;
 await getSql()`INSERT INTO outbox_actions (user_id,connection_id,kind,payload,state,created_at) VALUES (${ids[2]},${conn[2]},'jellyfin.sync','{}'::jsonb,'cancelled',NOW()-INTERVAL '2 hours')`;
 const busy=await enqueueAction({userId:ids[0],connectionId:conn[0],kind:'jellyfin.sync',payload:{}});
 const waiting=await onboardingStatus(ids[2]);expect(waiting.complete).toBe(false);expect(waiting.progress).toBeNull();
 await expect(retryOnboarding(ids[2])).rejects.toThrow('already queued or running');
 await getSql()`UPDATE outbox_actions SET state='cancelled' WHERE id=${busy}`;
 await retryOnboarding(ids[2]);expect((await onboardingStatus(ids[2])).progress?.state).toBe('pending');
 const [count]=await getSql()`SELECT count(*)::int AS total FROM outbox_actions WHERE user_id=${ids[2]} AND kind='jellyfin.sync' AND state IN ('pending','running')`;expect(count.total).toBe(1);
 await getSql()`update outbox_actions set state='failed',payload=payload||${{_jobFailure:{code:'provider.authentication'}}}::jsonb where user_id=${ids[2]} and kind='jellyfin.sync' and state='pending'`;
 const authentication=await onboardingStatus(ids[2]);expect(authentication.reconnect).toBe(true);expect(authentication.linked).toBe(false);expect(authentication.complete).toBe(false);
});

run('declining a session removes invitation access without starting playback',async()=>{
 const room=await createRoom(ids[0],{playbackId:play[0],positionSeconds:0});
 await inviteParticipant(ids[0],room.id,{friendId:ids[1]});
 await expect(declineInvitation(ids[2],room.id)).rejects.toThrow('not found');
 expect(await declineInvitation(ids[1],room.id)).toEqual({declined:true});
 await expect(roomState(ids[1],room.id)).rejects.toThrow('not found');
 const [notice]=await getSql()`select dismissed_at from notifications where user_id=${ids[1]} and source_key=${'synced:'+room.id}`;
 expect(notice.dismissed_at).not.toBeNull();
 await inviteParticipant(ids[0],room.id,{friendId:ids[1]});
 const [renewed]=await getSql()`select read_at,dismissed_at from notifications where user_id=${ids[1]} and source_key=${'synced:'+room.id}`;
 expect(renewed.read_at).toBeNull();expect(renewed.dismissed_at).toBeNull();
 await getSql()`update synced_rooms set created_at=now()-interval '25 hours' where id=${room.id}`;
 await expect(inviteParticipant(ids[0],room.id,{friendId:ids[1]})).rejects.toThrow('ended');
});

run('idle parties invite and join before playback, then retain membership through video/music switches',async()=>{
 let r=await createRoom(ids[0],{});
 expect(r.mediaId).toBeNull();
 await inviteParticipant(ids[0],r.id,{friendId:ids[1]});
 const [notice]=await getSql()`SELECT social_notification_visible(user_id,kind,data) AS visible FROM notifications WHERE source_key=${'synced:'+r.id} AND user_id=${ids[1]}`;expect(notice.visible).toBe(true);
 const invitation=(await listRooms(ids[1])).find(p=>p.id===r.id);expect(invitation?.mediaId).toBeNull();expect(invitation?.progress).toBeNull();expect(invitation?.participants.map(p=>p.userId)).toEqual([ids[0],ids[1]]);expect(invitation?.participants.find(p=>p.userId===ids[1])?.joined).toBe(false);
 expect((await listRooms(ids[2])).some(p=>p.id===r.id)).toBe(false);
 r=await joinRoom(ids[1],r.id,{revision:r.revision});
 expect(r.participants.find(p=>p.userId===ids[1])?.joined).toBe(true);
 expect((await listRooms(ids[1])).find(p=>p.id===r.id)?.participants).toHaveLength(2);
 await expect(commandRoom(ids[1],r.id,{action:'item',playbackId:play[1],revision:r.revision})).rejects.toThrow('host');
 r=await commandRoom(ids[0],r.id,{action:'item',playbackId:play[0],revision:r.revision});
 expect(r.mediaId).toBe(work);
 const [audio]=await getSql()`SELECT id FROM playback_sessions WHERE user_id=${ids[0]} AND media_type='audio' LIMIT 1`;
 r=await commandRoom(ids[0],r.id,{action:'item',playbackId:audio.id,queue:[musicIds[0],musicIds[1]],queueIndex:0,revision:r.revision});
 expect(r.mediaType).toBe('audio');
 expect(r.participants.find(p=>p.userId===ids[1])?.joined).toBe(true);
 r=await commandRoom(ids[0],r.id,{action:'item',playbackId:play[0],revision:r.revision});
 expect(r.mediaType).toBe('video');expect(r.queue).toEqual([]);
 r=await commandRoom(ids[0],r.id,{action:'stop',revision:r.revision});
 expect(r.mediaId).toBeNull();expect(r.ended).toBe(false);
 expect(r.participants.find(p=>p.userId===ids[1])?.joined).toBe(true);
 await leaveRoom(ids[0],r.id);
 expect((await listRooms(ids[1])).some(p=>p.id===r.id)).toBe(false);
});

run('live friend progress uses playback evidence and respects progress privacy',async()=>{
 await getSql()`UPDATE playback_sessions SET state='active',position_seconds=25,duration_seconds=100,updated_at=NOW(),expires_at=NOW()+INTERVAL '1 hour' WHERE id=${play[0]}`;
 const own=(await presence(ids[0])).find((row:{workId:string;progress:number|null})=>row.workId===work);
 expect(own?.progress).toBe(0.25);
 await getSql()`UPDATE users SET settings=jsonb_set(settings,'{social}', '{"audience":"friends","sections":{"progress":"private"}}'::jsonb) WHERE id=${ids[0]}`;
 const friend=(await presence(ids[1])).find((row:{userId:string;progress:number|null})=>row.userId===ids[0]);
 expect(friend).toBeDefined();
 expect(friend?.progress).toBeNull();
});

run('party creation preserves playing and paused state; idle parties remain paused',async()=>{
 const playing=await createRoom(ids[0],{playbackId:play[0],positionSeconds:25,paused:false});
 expect(playing.paused).toBe(false);expect(playing.bufferingPaused).toBe(false);
 const paused=await createRoom(ids[0],{playbackId:play[0],positionSeconds:25,paused:true});
 expect(paused.paused).toBe(true);
 const idle=await createRoom(ids[0],{paused:false});
 expect(idle.mediaId).toBeNull();expect(idle.paused).toBe(true);
});
run('party owner can remove pending members and transfer ownership without changing playback',async()=>{
 await getSql()`UPDATE playback_sessions SET state='active',duration_seconds=120,expires_at=NOW()+INTERVAL '1 hour' WHERE id IN (${play[0]},${play[1]})`;
 await getSql()`INSERT INTO friendships (user_a,user_b,requested_by,state) VALUES (least(${ids[0]}::uuid,${ids[1]}::uuid),greatest(${ids[0]}::uuid,${ids[1]}::uuid),${ids[0]},'accepted') ON CONFLICT (user_a,user_b) DO UPDATE SET state='accepted'`;
 let r=await createRoom(ids[0],{playbackId:play[0],positionSeconds:20,paused:false});
 await inviteParticipant(ids[0],r.id,{friendId:ids[1]});
 expect((await listRooms(ids[1])).find(room=>room.id===r.id)?.participants.find(member=>member.userId===ids[1])?.joined).toBe(false);
 await expect(commandRoom(ids[1],r.id,{action:'kick',userId:ids[0],revision:r.revision})).rejects.toThrow('host');
 await expect(commandRoom(ids[0],r.id,{action:'promote',userId:ids[1],revision:r.revision})).rejects.toThrow('joined');
 r=await commandRoom(ids[0],r.id,{action:'kick',userId:ids[1],revision:r.revision});
 await expect(roomState(ids[1],r.id)).rejects.toThrow('not found');
 await inviteParticipant(ids[0],r.id,{friendId:ids[1]});
 r=await joinRoom(ids[1],r.id,{playbackId:play[1],revision:r.revision});
 r=await commandRoom(ids[0],r.id,{action:'promote',userId:ids[1],revision:r.revision});
 expect(r.hostId).toBe(ids[1]);expect(r.mediaId).toBe(work);expect(r.paused).toBe(false);
 await expect(commandRoom(ids[0],r.id,{action:'pause',revision:r.revision})).rejects.toThrow('host');
 await expect(commandRoom(ids[1],r.id,{action:'kick',userId:ids[1],revision:r.revision})).rejects.toThrow('another');
 r=await commandRoom(ids[1],r.id,{action:'kick',userId:ids[0],revision:r.revision});
 expect(r.participants.some(member=>member.userId===ids[0])).toBe(false);
});

async function settingsParty(){
 await getSql()`UPDATE provider_connections SET status='connected' WHERE id IN (${conn[0]},${conn[1]})`;
 await getSql()`UPDATE playback_sessions SET state='active',duration_seconds=120,expires_at=NOW()+INTERVAL '1 hour' WHERE id IN (${play[0]},${play[1]})`;
 for(const [a,b] of [[ids[0],ids[1]],[ids[0],ids[2]],[ids[1],ids[2]]])await getSql()`INSERT INTO friendships (user_a,user_b,requested_by,state) VALUES (least(${a}::uuid,${b}::uuid),greatest(${a}::uuid,${b}::uuid),${a},'accepted') ON CONFLICT (user_a,user_b) DO UPDATE SET state='accepted'`;
 let r=await createRoom(ids[0],{playbackId:play[0],positionSeconds:20,paused:false});
 await inviteParticipant(ids[0],r.id,{friendId:ids[1]});
 return joinRoom(ids[1],r.id,{playbackId:play[1],revision:r.revision});
}
run('party settings authorize joined controllers without granting owner powers',async()=>{
 let r=await settingsParty();
 await expect(commandRoom(ids[1],r.id,{action:'pause',revision:r.revision})).rejects.toThrow('host');
 r=await commandRoom(ids[0],r.id,{action:'settings',settings:{...r.settings,playback:'selected',controllers:[ids[1]],invitations:'everyone'},revision:r.revision});
 r=await commandRoom(ids[1],r.id,{action:'pause',revision:r.revision});expect(r.paused).toBe(true);
 await expect(commandRoom(ids[1],r.id,{action:'settings',settings:{...r.settings,playback:'everyone'},revision:r.revision})).rejects.toThrow('host');
 await expect(commandRoom(ids[1],r.id,{action:'play',policy:'catch-up',revision:r.revision})).rejects.toThrow('matching');
 await inviteParticipant(ids[1],r.id,{friendId:ids[2]});
 await expect(commandRoom(ids[2],r.id,{action:'play',revision:r.revision})).rejects.toThrow('host');
 r=await commandRoom(ids[0],r.id,{action:'settings',settings:{...r.settings,acceptInvites:false},revision:r.revision});
 await expect(inviteParticipant(ids[1],r.id,{friendId:ids[2]})).rejects.toThrow('closed');
 r=await commandRoom(ids[1],r.id,{action:'stop',revision:r.revision});
 await expect(joinRoom(ids[2],r.id,{revision:r.revision})).rejects.toThrow('closed');
});
run('ready checks wait for each joined member and report unavailable playback',async()=>{
 let r=await settingsParty();
 r=await commandRoom(ids[0],r.id,{action:'settings',settings:{...r.settings,readyCheck:true},revision:r.revision});expect(r.bufferingPaused).toBe(true);
 r=await commandRoom(ids[0],r.id,{action:'ready',ready:true,revision:r.revision});expect(r.bufferingPaused).toBe(true);
 r=await commandRoom(ids[1],r.id,{action:'ready',ready:true,revision:r.revision});expect(r.bufferingPaused).toBe(false);
 r=await roomState(ids[1],r.id,{buffering:false,unavailable:true});expect(r.bufferingPaused).toBe(true);expect(r.participants.find(p=>p.userId===ids[1])?.unavailable).toBe(true);
 r=await roomState(ids[1],r.id,{buffering:false,unavailable:false});expect(r.bufferingPaused).toBe(false);
 r=await commandRoom(ids[0],r.id,{action:'item',playbackId:play[0],revision:r.revision});expect(r.participants.every(p=>!p.ready)).toBe(true);
});
run('host disconnect policy waits, gives bounded grace, or transfers to an eligible member',async()=>{
 let r=await settingsParty();
 await getSql()`UPDATE synced_participants SET heartbeat_at=NOW()-INTERVAL '20 seconds' WHERE room_id=${r.id} AND user_id=${ids[0]}`;
 r=await roomState(ids[1],r.id,{buffering:false});expect(r.bufferingPaused).toBe(true);
 r=await commandRoom(ids[0],r.id,{action:'settings',settings:{...r.settings,hostDisconnect:'continue'},revision:r.revision});expect(r.bufferingPaused).toBe(false);
 await getSql()`UPDATE synced_participants SET heartbeat_at=NOW()-INTERVAL '70 seconds' WHERE room_id=${r.id} AND user_id=${ids[0]}`;
 r=await roomState(ids[1],r.id,{buffering:false});expect(r.bufferingPaused).toBe(true);
 r=await commandRoom(ids[0],r.id,{action:'settings',settings:{...r.settings,hostDisconnect:'transfer'},revision:r.revision});expect(r.hostId).toBe(ids[1]);expect(r.bufferingPaused).toBe(false);
 await expect(commandRoom(ids[0],r.id,{action:'settings',settings:r.settings,revision:r.revision})).rejects.toThrow('host');
});
run('music queue edits preserve playback and enforce queue permissions',async()=>{
 let r=await settingsParty();
 const [audio]=await getSql()`SELECT id FROM playback_sessions WHERE user_id=${ids[0]} AND media_type='audio' LIMIT 1`;
 await getSql()`UPDATE playback_sessions SET state='active',expires_at=NOW()+INTERVAL '1 hour' WHERE id=${audio.id}`;
 r=await commandRoom(ids[0],r.id,{action:'item',playbackId:audio.id,queue:musicIds,queueIndex:0,revision:r.revision});
 await expect(commandRoom(ids[1],r.id,{action:'queue',queue:[...musicIds].reverse(),queueIndex:1,revision:r.revision})).rejects.toThrow('host');
 r=await commandRoom(ids[0],r.id,{action:'settings',settings:{...r.settings,queue:'everyone'},revision:r.revision});
 r=await commandRoom(ids[1],r.id,{action:'queue',queue:[...musicIds].reverse(),queueIndex:1,revision:r.revision});expect(r.queueIndex).toBe(1);expect(r.mediaId).toBe(musicIds[0]);
 await expect(commandRoom(ids[1],r.id,{action:'queue',queue:[musicIds[1]],queueIndex:0,revision:r.revision})).rejects.toThrow('playing track');
});

run('initial imports take priority without overlapping service work',async()=>{
 await getSql()`update outbox_actions set state='cancelled' where state in ('pending','running','failed')`;
 const calls:string[]=[];registerActionHandler('fixture.normal',async()=>{calls.push('ordinary');});registerActionHandler('jellyfin.sync',async()=>{calls.push('initial');});
 await enqueueAction({userId:ids[0],kind:'fixture.normal',payload:{}});
 await enqueueAction({userId:ids[2],connectionId:conn[2],kind:'jellyfin.sync',payload:{}});
 expect(await runQueueOnce()).toBe(true);expect(calls).toEqual(['initial']);
 expect(await runQueueOnce()).toBe(true);expect(calls).toEqual(['initial','ordinary']);
});
