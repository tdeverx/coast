import {test,expect,beforeAll,afterAll,beforeEach} from 'bun:test';
import {networkInterfaces} from 'node:os';
import {getSql,closeDb} from '../src/lib/server/db';
import {encryptCredential} from '../src/lib/server/security/credentials';
import {defaultConfig} from '../src/lib/server/config';
import {updateConfig} from '../src/lib/application/configuration.server';
import {createShare,claimShare,startShared,sharedStream,revokeShare,shareViewer,prepareShared} from '../src/lib/sharing/service.server';
import {openPublicShare,externalStream} from '../src/lib/sharing/external.server';
import {publicSharePath} from '../src/lib/sharing/policy';
import {releaseViewer,expireSharedViewers} from '../src/lib/sharing/leases.server';
import {sharedStreamRows} from '../src/lib/sharing/streams.server';
import {activeStreams,streamCount} from '../src/lib/application/streams.server';
import {POST as shareApiPost,GET as shareApiGet} from '../src/routes/api/share/[...path]/+server';
import {updateUser,updateUserSettings} from '../src/lib/server/auth';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const owner=crypto.randomUUID(),other=crypto.randomUUID(),work=crypto.randomUUID(),instance=crypto.randomUUID(),connection=crypto.randomUUID(),providerItem=crypto.randomUUID(),generation=crypto.randomUUID();
const actor={id:owner,username:'sharing-admin',role:'admin' as const,email:null,settings:{}};
const browser={containers:['mp4'],videoCodecs:['h264'],audioCodecs:['aac'],nativeHls:false,hlsJs:true};
let failStop=false;
let directSource=false;
let playbackRequests:any[]=[];
let playbackInfoBarrier:{entered:()=>void;ready:Promise<void>}|undefined;
let manifestBarrier:{entered:()=>void;ready:Promise<void>}|undefined;
let server:ReturnType<typeof Bun.serve>,stops:{device:string|null;session:string|null}[]=[],segments:{session:string|null;rate:string|null}[]=[];
beforeAll(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const address=Object.values(networkInterfaces()).flat().find(i=>i&&!i.internal&&i.family==='IPv4'&&/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address;
 if(!address)throw new Error('Sharing HTTP fixtures require a private IPv4 interface.');
 server=Bun.serve({hostname:'0.0.0.0',port:0,fetch:async request=>{
  const url=new URL(request.url),p=url.pathname;
  if(p==='/System/Info/Public')return Response.json({Id:'fixture',ServerName:'Fixture',ProductName:'Jellyfin Server',Version:'12.2.0'});
  if(p==='/Users/fixture-user/Items/item')return Response.json({Id:'item',Name:'Fixture',Type:'Movie'});
  if(p==='/Items/item/PlaybackInfo') {
   const input=await request.json();playbackRequests.push(input);if(input.DeviceProfile.Name.startsWith('Coast VRChat')){expect(input.EnableDirectPlay).toBe(false);expect(input.AllowVideoStreamCopy).toBe(false);}
   const barrier=playbackInfoBarrier;playbackInfoBarrier=undefined;if(barrier){barrier.entered();await barrier.ready;}
   return Response.json({PlaySessionId:crypto.randomUUID(),MediaSources:[{Id:'source',Container:directSource?'mp4':'mkv',Bitrate:directSource?500000:10000000,RunTimeTicks:6000000000,SupportsTranscoding:true,SupportsDirectPlay:directSource,TranscodingUrl:'/Videos/item/master.m3u8?api_key=fixture-upstream-secret',MediaStreams:[{Index:0,Type:'Video',Codec:'h264',Width:1920,Height:1080,RealFrameRate:59.94},{Index:1,Type:'Audio',Codec:'aac'}]}]});
  }
  if(p==='/Videos/ActiveEncodings') {if(failStop)return new Response('Synthetic stop failure',{status:400});stops.push({device:url.searchParams.get('DeviceId'),session:url.searchParams.get('PlaySessionId')});return new Response(null,{status:204});}
  if(p.endsWith('master.m3u8')){const barrier=manifestBarrier;manifestBarrier=undefined;if(barrier){barrier.entered();await barrier.ready;}return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nmain.m3u8?api_key=fixture-upstream-secret\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});}
  if(p.endsWith('main.m3u8'))return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\nsegment.ts?runtimeTicks=300000000&api_key=fixture-upstream-secret\n#EXT-X-ENDLIST\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
  if(p.endsWith('segment.ts')) {const data={session:url.searchParams.get('PlaySessionId'),rate:url.searchParams.get('VideoBitrate')};segments.push(data);return new Response(JSON.stringify(data),{headers:{'content-type':'video/mp2t'}});}
  if(p==='/Videos/item/stream')return new Response('authored direct media fixture',{headers:{'content-type':'video/mp4'}});
  return new Response('Fixture route unavailable',{status:404});
 }});
 const db=getSql();
 await db`insert into users(id,username,role,settings) values(${owner},'sharing-admin','admin',${{sharedBitrateMbps:2}}),(${other},'sharing-user','user',${{}})`;
 await db`insert into media(id,kind,title) values(${work},'movie','Sharing fixture')`;
 await db`insert into provider_instances(id,provider,name,base_url,server_identity,settings) values(${instance},'jellyfin','Fixture',${'http://'+address+':'+server.port},'fixture',${{approved:true,allowPrivateNetwork:true}})`;
 await db`insert into provider_connections(id,user_id,instance_id,status,account_generation,external_user_id,credentials) values(${connection},${owner},${instance},'connected',${generation},'fixture-user',${await encryptCredential(JSON.stringify({accessToken:'fixture-upstream-secret'}))})`;
 await db`insert into provider_items(id,instance_id,media_id,external_id,kind) values(${providerItem},${instance},${work},'item','movie')`;
 await db`insert into availability(user_id,connection_id,media_id,provider_item_id,source_id) values(${owner},${connection},${work},${providerItem},'source')`;
 await db`insert into system_settings(key,value) values('coast',${{...defaultConfig,allowPlaybackSharing:true,allowedProviderPorts:[server.port!],maxBitrateMbps:10}}) on conflict(key) do update set value=excluded.value`;
});
beforeEach(async()=>{
 if(process.env.COAST_DB_TEST!=='1')return;
 const db=getSql();await db`delete from share_viewers`;await db`delete from playback_sessions`;await db`delete from playback_shares`;stops=[];segments=[];failStop=false;directSource=false;playbackRequests=[];playbackInfoBarrier=undefined;
 await db`update users set settings=${{sharedBitrateMbps:2}} where id=${owner}`;
 await db`update system_settings set value=${{...defaultConfig,allowPlaybackSharing:true,allowedProviderPorts:[server.port!],maxBitrateMbps:10}} where key='coast'`;
});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1'){server?.stop(true);await closeDb();}});
const make=()=>createShare(actor,{workId:work,connectionId:connection,hours:1,target:'vrchat'});
const request=(url:string,ua='fixture-a')=>new Request(new URL(url,'http://coast.test'),{headers:{accept:'*/*','user-agent':ua}});
const child=async(response:Response)=>{const body=await response.text();expect(body).not.toContain('fixture-upstream-secret');return body.split('\n').find(line=>line&&!line.startsWith('#'))!;};
run('website invitations always open Coast and use its ordinary direct/relay policy without transcoding',async()=>{
 directSource=true;
 await updateConfig(actor,{allowTranscoding:false});
 await getSql()`update users set settings=${{sharedBitrateMbps:2,personalBitrateMbps:1}} where id=${owner}`;
 const link=await createShare(actor,{workId:work,connectionId:connection,hours:1});
 expect(link.target).toBe('website');expect(publicSharePath(link.token)).not.toContain('.m3u8');
 for(const suffix of ['', '.m3u8']){
  const response=await openPublicShare(link.token+suffix,request(publicSharePath(link.token)+suffix+'?play=1','AVProMobileVideo'),'fixture-address');
  expect(response.status).toBe(302);expect(response.headers.get('location')).toBe('/share#invite='+link.token);
 }
 expect((await getSql()`select count(*)::int as n from share_viewers`)[0].n).toBe(0);
 const grant=await claimShare({token:link.token},null),session=await startShared(grant.token,{mediaId:work,browser});
 expect(playbackRequests.at(-1).EnableDirectPlay).toBe(true);expect(playbackRequests.at(-1).DeviceProfile.Name).toBe('Coast browser');
 const [saved]=await getSql()`select delivery,stream_path,max_bitrate from playback_sessions where id=${session.id}`;
 expect(saved.delivery).toBe('direct');expect(saved.stream_path).not.toContain('SegmentLength');expect(saved.max_bitrate).toBe(1_000_000);
 const response=await sharedStream(grant.token,session.id,request(session.url));expect(response.headers.get('content-type')).toBe('video/mp4');await response.text();
 await getSql()`update users set settings=${{sharedBitrateMbps:2,personalBitrateMbps:0.5}} where id=${owner}`;
 const replay=await startShared(grant.token,{mediaId:work,browser});
 await (await sharedStream(grant.token,replay.id,request(replay.url))).text();
 const [limited]=await getSql()`select max_bitrate,bitrate_ceiling from playback_sessions where id=${replay.id}`;
 expect(limited.max_bitrate).toBe(500_000);expect(limited.bitrate_ceiling).toBe(500_000);
});
run('H.265 is an admin-enabled VRChat option and withdrawing it rejects existing media capabilities',async()=>{
 await expect(createShare(actor,{workId:work,connectionId:connection,target:'vrchat',videoCodec:'hevc'})).rejects.toThrow('disabled');
 await expect(updateConfig({...actor,id:other,role:'user'},{allowVrchatHevc:true})).rejects.toThrow('Administrator');
 await updateConfig(actor,{allowVrchatHevc:true});
 await expect(createShare(actor,{workId:work,connectionId:connection,target:'website',videoCodec:'hevc'})).rejects.toThrow('valid sharing');
 const link=await createShare(actor,{workId:work,connectionId:connection,target:'vrchat',videoCodec:'hevc'});
 const variant=await child(await openPublicShare(link.token,request(publicSharePath(link.token,'vrchat')),'fixture-address'));
 const body=playbackRequests.at(-1);expect(body.DeviceProfile.TranscodingProfiles[0]).toMatchObject({VideoCodec:'hevc',Container:'mp4',SegmentLength:4});
 const [saved]=await getSql()`select stream_path from playback_sessions where share_id=${link.id}`;const path=new URL(saved.stream_path,'http://fixture');
 expect(path.searchParams.get('SegmentContainer')).toBe('mp4');expect(path.searchParams.get('aac-profile')).toBe('lc');
 expect(path.searchParams.get('hevc-level')).toBe('123');
 expect(path.searchParams.has('Framerate')).toBe(false);expect(path.searchParams.has('MaxFramerate')).toBe(false);
 await updateConfig(actor,{allowVrchatHevc:false});
 await expect(externalStream(variant.split('/')[4],request(variant))).rejects.toThrow('disabled');
});
run('VRChat uses native cadence and an H.264 level sufficient for the selected 1080p59.94 source',async()=>{
 const link=await make(),grant=await claimShare({token:link.token},null),session=await startShared(grant.token,{mediaId:work,browser});
 const [saved]=await getSql()`select stream_path from playback_sessions where id=${session.id}`;const path=new URL(saved.stream_path,'http://fixture');
 expect(path.searchParams.get('h264-level')).toBe('42');expect(path.searchParams.get('SegmentLength')).toBe('4');
 expect(path.searchParams.get('AudioBitrate')).toBe('192000');expect(path.searchParams.get('AudioSampleRate')).toBe('48000');
 expect(path.searchParams.get('MaxWidth')).toBe('1920');expect(path.searchParams.has('Framerate')).toBe(false);
});
run('reusable links create separate browser viewers without changing the owner history',async()=>{
 const link=await make(),[a,b]=await Promise.all([claimShare({token:link.token},null),claimShare({token:link.token},null)]);
 expect(a.token).not.toBe(b.token);
 const first=await startShared(a.token,{mediaId:work,browser}),second=await startShared(b.token,{mediaId:work,browser});expect(first.id).not.toBe(second.id);
 const rows=await getSql()`select id,provider_device_id,max_bitrate from playback_sessions order by created_at`;
 expect(rows[0].provider_device_id).not.toBe(rows[1].provider_device_id);expect(rows[1].max_bitrate).toBe(850000);
 expect((await getSql()`select count(*)::int as n from tracking_events where user_id=${owner}`)[0].n).toBe(0);
 await expect(startShared(a.token,{mediaId:other,browser})).rejects.toThrow('only its selected item');
});
run('native link probes do not allocate viewers; media URLs are cookie-free and viewer-bound',async()=>{
 const link=await make(),url='http://coast.test'+publicSharePath(link.token,'vrchat'),entry=new URL(url).pathname.split('/').at(-1)!;
 const head=await openPublicShare(entry,new Request(url,{method:'HEAD'}),'fixture-address');expect(head.status).toBe(200);expect(head.headers.get('content-type')).toContain('mpegurl');
 const web=await createShare(actor,{workId:work,connectionId:connection,hours:1});const webUrl='http://coast.test'+publicSharePath(web.token);const html=await openPublicShare(web.token,new Request(webUrl,{headers:{accept:'text/html'}}),'fixture-address');expect(html.status).toBe(302);expect(html.headers.get('location')).toBe('/share#invite='+web.token);
 expect((await getSql()`select count(*)::int as n from share_viewers`)[0].n).toBe(0);
 const master=await openPublicShare(entry,request(url,'AVProMobileVideo (Linux;Android 14) ExoPlayerLib/1.8.0'),'fixture-address'),variant=await child(master);
 expect(new URL(variant,'http://coast.test').pathname).toEndWith('/stream.m3u8');
 const variantRequest=request(variant);
 const leaf=await child(await shareApiGet({request:variantRequest,params:{path:`external/${variant.split('/')[4]}/stream.m3u8`},cookies:{get:()=>undefined},locals:{user:null},url:new URL(variantRequest.url)} as any));
 expect(new URL(leaf,'http://coast.test').pathname).toEndWith('/stream');
 const id=leaf.split('/')[4],response=await externalStream(id,request(leaf));expect(response.status).toBe(200);await response.text();
 await openPublicShare(entry,request(url,'AVProMobileVideo (Linux;Android 14) ExoPlayerLib/1.8.0'),'fixture-address');expect((await getSql()`select count(*)::int as n from share_viewers`)[0].n).toBe(1);
 await expect(externalStream(id,request(leaf.replace(/access=[^&]+/,'access=invalid')))).rejects.toThrow('Invalid viewer');
 await revokeShare(actor,link.id);await expect(externalStream(id,request(leaf))).rejects.toThrow('revoked');
});
run('VRChat viewers use the normal personal target inside an independently larger sharing budget',async()=>{
 await getSql()`update users set settings=${{personalBitrateMbps:1,sharedBitrateMbps:40}} where id=${owner}`;
 const link=await make(),grants=await Promise.all([claimShare({token:link.token},null),claimShare({token:link.token},null)]);
 for(const grant of grants)await startShared(grant.token,{mediaId:work,browser});
 const rows=await getSql()`select v.desired_bitrate,p.max_bitrate,p.bitrate_ceiling from share_viewers v join playback_sessions p on p.id=v.playback_id`;
 expect(rows).toHaveLength(2);
 for(const row of rows)expect(row).toMatchObject({desired_bitrate:1_000_000,max_bitrate:1_000_000,bitrate_ceiling:1_000_000});
});
run('a larger shared pool restores normal targets and a smaller pool reduces the same viewer again',async()=>{
 await getSql()`update system_settings set value=jsonb_set(value,'{maxBitrateMbps}','4') where key='coast'`;
 await getSql()`update users set settings=${{personalBitrateMbps:4,sharedBitrateMbps:4}} where id=${owner}`;
 const link=await make(),grants=await Promise.all(Array.from({length:3},()=>claimShare({token:link.token},null)));
 const sessions=[];for(const grant of grants)sessions.push(await startShared(grant.token,{mediaId:work,browser}));
 const last=sessions[2];expect((await getSql()`select max_bitrate from playback_sessions where id=${last.id}`)[0].max_bitrate).toBe(1_100_000);
 for(const [budget,expected]of [[40,4_000_000],[4,1_100_000]]){
  await getSql()`update users set settings=${{personalBitrateMbps:4,sharedBitrateMbps:budget}} where id=${owner}`;
  await getSql()`update share_viewers set last_seen_at=now()-interval '11 seconds'`;
  const response=await sharedStream(grants[2].token,last.id,request(last.url));expect(response.status).toBe(200);await response.text();
  const [row]=await getSql()`select v.desired_bitrate,p.max_bitrate,p.bitrate_ceiling from share_viewers v join playback_sessions p on p.id=v.playback_id where p.id=${last.id}`;
  expect(row).toMatchObject({desired_bitrate:expected,max_bitrate:expected,bitrate_ceiling:4_000_000});
 }
});
run('a saved stable segment URL moves to a new provider generation after another viewer joins',async()=>{
 const link=await make(),a=await claimShare({token:link.token},null),b=await claimShare({token:link.token},null);
 const first=await startShared(a.token,{mediaId:work,browser});
 const variant=await child(await sharedStream(a.token,first.id,request(first.url)));
 const segment=await child(await sharedStream(a.token,first.id,request(variant)));
 const before=await (await sharedStream(a.token,first.id,request(segment))).json();
 const second=await startShared(b.token,{mediaId:work,browser});
 const [otherBefore]=await getSql()`select provider_session_id from playback_sessions where id=${second.id}`;
 const results=await Promise.all([sharedStream(a.token,first.id,request(segment)),sharedStream(a.token,first.id,request(segment))]);
 const after=await results[0].json();await results[1].text();expect(after.session).not.toBe(before.session);expect(Number(after.rate)).toBeLessThan(Number(before.rate));expect(stops).toHaveLength(1);
 expect(stops[0].device).not.toBe(owner);expect((await getSql()`select provider_session_id from playback_sessions where id=${second.id}`)[0].provider_session_id).toBe(otherBefore.provider_session_id);
});
run('admission respects the aggregate budget, and idle viewers release their slot',async()=>{
 const link=await make(),otherLink=await make(),grants=await Promise.all(Array.from({length:4},(_,i)=>claimShare({token:i%2?otherLink.token:link.token},null)));
 for(let i=0;i<3;i++)await startShared(grants[i].token,{mediaId:work,browser});
 await expect(startShared(grants[3].token,{mediaId:work,browser})).rejects.toThrow('bandwidth is full');
 const unadmitted=await shareViewer(grants[3].token);
 await getSql()`update share_viewers set created_at=now()-interval '1 hour' where id=${unadmitted.viewer_id}`;
 // Claims are concurrent: the oldest claim may be the fourth, unadmitted viewer.
 // Expire a known admitted viewer rather than relying on insertion order.
 const admitted=await shareViewer(grants[0].token);
 const [old]=await getSql()`update share_viewers set last_seen_at=now()-interval '3 minutes' where id=${admitted.viewer_id} and playback_id is not null returning id`;
 expect(old.id).toBe(admitted.viewer_id);
 await expireSharedViewers();expect(stops).toHaveLength(1);
 expect((await getSql()`select ended_at from share_viewers where id=${old.id}`)[0].ended_at).toBeTruthy();
 await startShared(grants[3].token,{mediaId:work,browser});
 expect((await sharedStreamRows('now')).length).toBe(3);expect((await sharedStreamRows('history')).length).toBe(1);
});
run('only an administrator can set independent personal and shared bandwidth limits',async()=>{
 const user={...actor,id:other,role:'user' as const};
 await updateUserSettings(user,{personalBitrateMbps:999,sharedBitrateMbps:999});
 expect((await getSql()`select settings from users where id=${other}`)[0].settings.personalBitrateMbps).toBeUndefined();
 await expect(updateUser(user,owner,{sharedBitrateMbps:999})).rejects.toThrow('Administrator');
 await updateUser(actor,other,{personalBitrateMbps:4,sharedBitrateMbps:8});expect((await getSql()`select settings from users where id=${other}`)[0].settings).toMatchObject({personalBitrateMbps:4,sharedBitrateMbps:8});
});

run('expiry and account replacement invalidate existing cookie-free resource grants',async()=>{
 const link=await make(),url='http://coast.test/share/'+link.token;
 const variant=await child(await openPublicShare(link.token,request(url),'fixture-address'));
 const id=variant.split('/')[4];
 await getSql()`update playback_shares set expires_at=now()-interval '1 second' where id=${link.id}`;
 await expect(externalStream(id,request(variant))).rejects.toThrow('expired');
 await getSql()`update playback_shares set expires_at=now()+interval '1 hour' where id=${link.id}`;
 await getSql()`update provider_connections set account_generation=${crypto.randomUUID()} where id=${connection}`;
 await expect(externalStream(id,request(variant))).rejects.toThrow('no longer accessible');
 await getSql()`update provider_connections set account_generation=${generation} where id=${connection}`;
});
run('failed encoder cleanup remains durable and retries without resurrecting playback',async()=>{
 const link=await make(),grant=await claimShare({token:link.token},null);
 const session=await startShared(grant.token,{mediaId:work,browser});
 const [viewer]=await getSql()`select id from share_viewers where playback_id=${session.id}`;
 failStop=true;await expect(releaseViewer(owner,viewer.id)).rejects.toThrow('HTTP 400');
 expect((await getSql()`select state,cleanup_pending from playback_sessions where id=${session.id}`)[0]).toMatchObject({state:'stopped',cleanup_pending:true});
 failStop=false;await expireSharedViewers();
 expect((await getSql()`select state,cleanup_pending from playback_sessions where id=${session.id}`)[0]).toMatchObject({state:'stopped',cleanup_pending:false});
 await expect(sharedStream(grant.token,session.id,request(session.url))).rejects.toThrow('expired');
});

run('Active streams attributes shared viewers and excludes matching Jellyfin observations',async()=>{
 const link=await make(),grant=await claimShare({token:link.token},null),session=await startShared(grant.token,{mediaId:work,browser});
 const [playback]=await getSql()`select provider_device_id from playback_sessions where id=${session.id}`;
 await getSql()`insert into server_stream_scans(instance_id,connection_id,account_generation) values(${instance},${connection},${generation}) on conflict(instance_id) do update set checked_at=now()`;
 await getSql()`insert into server_stream_sessions(instance_id,session_id,external_item_id,snapshot) values(${instance},'duplicated-server-observation','item',${{id:'provider',deviceId:playback.provider_device_id,externalId:'item',username:'Fixture',title:'Sharing fixture'}})`;
 const now=await activeStreams(actor);expect(now.streams).toHaveLength(1);expect(now.streams[0].sharing).toMatchObject({creator:'sharing-admin',viewers:1,estimated:true});expect((await streamCount(actor)).active).toBe(1);
 expect(JSON.stringify(now)).not.toContain('fixture-upstream-secret');
 const [viewer]=await getSql()`select id from share_viewers where playback_id=${session.id}`;await releaseViewer(owner,viewer.id);
 expect((await activeStreams(actor,{view:'history'})).streams.some(stream=>stream.sharing?.creator==='sharing-admin')).toBe(true);
});

run('reopening the same viewer retains the previous playback in shared history',async()=>{
 const link=await make(),grant=await claimShare({token:link.token},null),first=await startShared(grant.token,{mediaId:work,browser});
 const [viewer]=await getSql()`select id from share_viewers where playback_id=${first.id}`;await releaseViewer(owner,viewer.id);
 const second=await startShared(grant.token,{mediaId:work,browser});expect(second.id).not.toBe(first.id);
 expect((await sharedStreamRows('history')).map(row=>row.id)).toContain(first.id);
 expect((await sharedStreamRows('now')).map(row=>row.id)).toEqual([second.id]);
});

run('rebalancing never raises a viewer above its selected lower bitrate ceiling',async()=>{
 const link=await make(),grant=await claimShare({token:link.token},null);
 const session=await startShared(grant.token,{mediaId:work,browser:{...browser,maxBitrate:600000}});
 const response=await sharedStream(grant.token,session.id,request(session.url));await response.text();
 expect((await getSql()`select max_bitrate from playback_sessions where id=${session.id}`)[0].max_bitrate).toBe(600000);expect(stops).toHaveLength(0);
});

run('replay stops retired encoders before preparing another independent session',async()=>{
 const link=await make(),grant=await claimShare({token:link.token},null);
 for(let index=0;index<6;index++){
  const session=await startShared(grant.token,{mediaId:work,browser});
  await (await sharedStream(grant.token,session.id,request(session.url))).text();
 }
 expect(stops).toHaveLength(5);
 expect((await getSql()`select count(*)::int as n from playback_sessions where cleanup_pending`)[0].n).toBe(0);
 expect((await getSql()`select count(*)::int as n from playback_sessions where state<>'stopped'`)[0].n).toBe(1);
});

run('failed cleanup blocks replacements and other viewer starts until the stop succeeds',async()=>{
 const link=await make(),a=await claimShare({token:link.token},null),b=await claimShare({token:link.token},null);
 await startShared(a.token,{mediaId:work,browser});failStop=true;
 await expect(startShared(a.token,{mediaId:work,browser})).rejects.toThrow('HTTP 400');
 await expect(startShared(b.token,{mediaId:work,browser})).rejects.toThrow('HTTP 400');
 expect((await getSql()`select count(*)::int as n from playback_sessions`)[0].n).toBe(1);
 failStop=false;await startShared(a.token,{mediaId:work,browser});
 expect(stops).toHaveLength(1);
 expect((await getSql()`select count(*)::int as n from playback_sessions where cleanup_pending`)[0].n).toBe(0);
});

run('a preparation snapshot cannot leave a newer attached encoder running',async()=>{
 const link=await make(),grant=await claimShare({token:link.token},null),stale=await shareViewer(grant.token);
 const first=await startShared(grant.token,{mediaId:work,browser});
 const [old]=await getSql()`select provider_session_id from playback_sessions where id=${first.id}`;
 const second=await prepareShared(stale,{mediaId:work,browser});
 expect(second.id).not.toBe(first.id);expect(stops.map(stop=>stop.session)).toEqual([old.provider_session_id]);
});

run('lowering a budget retains the earliest admitted viewers and durably stops the excess',async()=>{
 const link=await make(),grants=await Promise.all(Array.from({length:3},()=>claimShare({token:link.token},null)));
 for(const grant of grants)await startShared(grant.token,{mediaId:work,browser});
 const [retained]=await getSql()`select v.id,v.playback_id,v.token_hash from share_viewers v order by created_at,id limit 1`;
 await getSql()`update users set settings=${{sharedBitrateMbps:1}} where id=${owner}`;
 await getSql()`update share_viewers set last_seen_at=now()-interval '11 seconds'`;
 // Make the evicted viewer encounter the new budget first: its 429 must not roll back reconciliation.
 const {hashToken}=await import('../src/lib/server/auth');
 const survivor=(await Promise.all(grants.map(async grant=>({...grant,hash:await hashToken(grant.token)})))).find(grant=>grant.hash===retained.token_hash)!;
 const rejected=grants.find(grant=>grant.token!==survivor.token)!;
 const rejectedViewer=await shareViewer(rejected.token);
 await expect(sharedStream(rejected.token,rejectedViewer.playback_id,request('/stream'))).rejects.toMatchObject({status:429});
 expect((await getSql()<{id:string}[]>`select id from share_viewers where ended_at is null`).map(row=>row.id)).toEqual([retained.id]);
 expect(stops).toHaveLength(2);
 const response=await sharedStream(survivor.token,retained.playback_id,request('/stream'));expect(response.status).toBe(200);await response.text();
 expect((await getSql()`select max_bitrate from playback_sessions where id=${retained.playback_id}`)[0].max_bitrate).toBe(850000);
});

run('in-flight shared dispatches finish before replay retires their encoder',async()=>{
 const link=await make(),grant=await claimShare({token:link.token},null),first=await startShared(grant.token,{mediaId:work,browser});
 let entered!:()=>void,release!:()=>void;
 const entering=new Promise<void>(resolve=>{entered=resolve;});
 manifestBarrier={entered,ready:new Promise(resolve=>{release=resolve;})};
 const resource=sharedStream(grant.token,first.id,request(first.url));await entering;
 const replay=startShared(grant.token,{mediaId:work,browser});
 try{
  for(let i=0;i<100;i++){if((await getSql()`select preparation_token from share_viewers where playback_id=${first.id}`)[0]?.preparation_token)break;await new Promise(resolve=>setTimeout(resolve,10));}
  expect((await getSql()`select count(*)::int as n from share_request_leases where playback_id=${first.id}`)[0].n).toBe(1);
  expect(stops).toHaveLength(0);
 }finally{release();}
 await (await resource).text();const second=await replay;
 expect(second.id).not.toBe(first.id);expect(stops).toHaveLength(1);
 expect((await getSql()`select count(*)::int as n from share_request_leases`)[0].n).toBe(0);
});

run('quality handoffs drain parallel dispatches and crashed request leases expire',async()=>{
 const link=await make(),a=await claimShare({token:link.token},null),first=await startShared(a.token,{mediaId:work,browser});
 let entered!:()=>void,release!:()=>void;
 const entering=new Promise<void>(resolve=>{entered=resolve;});
 manifestBarrier={entered,ready:new Promise(resolve=>{release=resolve;})};
 const resource=sharedStream(a.token,first.id,request(first.url));await entering;
 const b=await claimShare({token:link.token},null);await startShared(b.token,{mediaId:work,browser});
 const changing=sharedStream(a.token,first.id,request(first.url));
 try{
  for(let i=0;i<100;i++){if((await getSql()`select preparation_token from share_viewers where playback_id=${first.id}`)[0]?.preparation_token)break;await new Promise(resolve=>setTimeout(resolve,10));}
  expect(stops).toHaveLength(0);
 }finally{release();}
 await (await resource).text();await (await changing).text();expect(stops).toHaveLength(1);
 const [viewer]=await getSql()`select id from share_viewers where playback_id=${first.id}`;
 await getSql()`insert into share_request_leases(id,viewer_id,playback_id,expires_at) values(${crypto.randomUUID()},${viewer.id},${first.id},now()-interval '1 second')`;
 await startShared(a.token,{mediaId:work,browser});expect(stops).toHaveLength(2);
 expect((await getSql()`select count(*)::int as n from share_request_leases`)[0].n).toBe(0);
});


run('aborting shared preparation through the API retires its reservation and cannot publish a session',async()=>{
 const link=await make(),grant=await claimShare({token:link.token},null),abort=new AbortController();
 let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(resolve=>enter=resolve),released=new Promise<void>(resolve=>release=resolve);
 playbackInfoBarrier={entered:enter,ready:released};
 const url=new URL('http://coast.test/api/share/playback');
 const pending=shareApiPost({url,params:{path:'playback'},locals:{user:null},cookies:{get:()=>grant.token},request:new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mediaId:work,browser}),signal:abort.signal})} as unknown as Parameters<typeof shareApiPost>[0]);
 await entered;
 try{abort.abort(new DOMException('Viewer closed','AbortError'));}finally{release();}
 const response=await pending;expect(response.ok).toBe(false);
 const [viewer]=await getSql()<{ended_at:Date|null;preparing_until:Date|null;preparation_token:string|null;playback_id:string|null}[]>`select ended_at,preparing_until,preparation_token,playback_id from share_viewers where share_id=${link.id}`;
 expect(viewer.ended_at).not.toBeNull();expect(viewer.preparing_until).toBeNull();expect(viewer.preparation_token).toBeNull();expect(viewer.playback_id).toBeNull();
 expect((await getSql()<{id:string}[]>`select id from playback_sessions where share_id=${link.id} and state<>'stopped'`)).toHaveLength(0);
 expect((await getSql()<{id:string}[]>`select id from tracking_events where user_id=${owner}`)).toHaveLength(0);
 const retry=await startShared(grant.token,{mediaId:work,browser});expect(retry.shareId).toBe(link.id);
});

run('withdrawn quality handoffs leave the encoder generation intact and release their preparation fence',async()=>{
 const link=await make(),a=await claimShare({token:link.token},null),first=await startShared(a.token,{mediaId:work,browser});
 const [before]=await getSql()`select provider_session_id,max_bitrate from playback_sessions where id=${first.id}`;
 let entered!:()=>void,release!:()=>void;
 const entering=new Promise<void>(resolve=>{entered=resolve;});manifestBarrier={entered,ready:new Promise(resolve=>{release=resolve;})};
 const resource=sharedStream(a.token,first.id,request(first.url));await entering;
 const b=await claimShare({token:link.token},null);await startShared(b.token,{mediaId:work,browser});
 const abort=new AbortController();
 const changing=sharedStream(a.token,first.id,new Request(request(first.url),{signal:abort.signal}));
 try{
  for(let i=0;i<100;i++){if((await getSql()`select preparation_token from share_viewers where playback_id=${first.id}`)[0]?.preparation_token)break;await new Promise(resolve=>setTimeout(resolve,10));}
  expect((await getSql()`select preparation_token from share_viewers where playback_id=${first.id}`)[0]?.preparation_token).not.toBeNull();
  abort.abort(new DOMException('Viewer closed','AbortError'));await expect(changing).rejects.toThrow('Viewer closed');
  expect(stops).toHaveLength(0);
  const [after]=await getSql()`select provider_session_id,max_bitrate from playback_sessions where id=${first.id}`;
  expect(after.provider_session_id).toBe(before.provider_session_id);expect(after.max_bitrate).toBe(before.max_bitrate);
  expect((await getSql()`select preparation_token from share_viewers where playback_id=${first.id}`)[0].preparation_token).toBeNull();
 }finally{release();await (await resource).text();}
 const retry=await sharedStream(a.token,first.id,request(first.url));await retry.text();expect(stops).toHaveLength(1);
 expect((await getSql()`select count(*)::int as n from share_request_leases`)[0].n).toBe(0);
});
