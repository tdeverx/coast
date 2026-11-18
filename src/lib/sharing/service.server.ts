import { featureDenialMessage,getFeatureConfig } from '#lib/server/features.js';
import {requestPriority} from '#lib/server/security/request-priority.js';
import { categoryEnabled } from '#lib/experimental.js';
import * as v from 'valibot';
import { getSql } from '#lib/server/db/index.js';
import { AppError } from '#lib/server/security/errors.js';
import { hashToken,randomToken,requireUser,type SessionUser } from '#lib/server/auth/index.js';
import { encryptCredential } from '#lib/server/security/credentials.js';
import { getJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import { startPlayback,streamPlayback } from '#lib/playback/service.server.js';
import { withSharedRequest } from './request-leases.server';
import {externalShareResourcePath,shareCompletionPercent} from './policy';
import { reserveViewer, ensureSharedEncoding, releaseViewer, stopViewerPlayback } from './leases.server';
import { completeShare, recordShareSegment } from './progress.server';
import { readingShareSource } from '#lib/reading/sessions.server.js';

const uuid=v.pipe(v.string(),v.uuid());
export const shareCookie='coast_share_viewer';
export async function createShare(actor:SessionUser|null,input:unknown){
 const user=requireUser(actor),config=await getFeatureConfig(user.id);
 if(!config.allowPlaybackSharing)throw new AppError(403,featureDenialMessage(config.featureDenials.sharing),'feature_disabled');
 if(user.role!=='admin'&&user.settings.allowPlaybackSharing!==true)throw new AppError(403,'A Coast admin needs to grant playback sharing.','sharing_grant_required');
 const data=v.parse(v.strictObject({workId:uuid,connectionId:uuid,hours:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(24)),6),together:v.optional(v.boolean(),false),target:v.optional(v.picklist(['website','vrchat']),'website'),videoCodec:v.optional(v.picklist(['h264','hevc']),'h264'),autoRevoke:v.optional(v.boolean(),false),trackProgress:v.optional(v.boolean(),false)}),input);
 if(data.target==='vrchat'&&!config.allowTranscoding)throw new AppError(400,'VRChat sharing requires Jellyfin transcoding.');
 if(data.target==='website'&&data.videoCodec!=='h264'||data.target==='vrchat'&&data.together)throw new AppError(400,'Choose a valid sharing destination.');
 if(data.videoCodec==='hevc'&&!config.allowVrchatHevc)throw new AppError(403,'H.265 VRChat sharing is disabled by the administrator.');
 if(data.together&&!config.experimentalParties)throw new AppError(400,'Synced playback is experimental. Enable it before sharing together.');
 const context=await getJellyfin(user.id,data.connectionId);
 await context.adapter.identity(context.instance.serverIdentity??undefined);
 const db=getSql(),sources=await db<{external_id:string;kind:string}[]>`select distinct pi.external_id,w.kind from availability a join provider_items pi on pi.id=a.provider_item_id join works w on w.id=a.media_id where a.user_id=${user.id} and a.connection_id=${data.connectionId} and a.media_id=${data.workId} and a.state='available' and w.kind in ('movie','episode','track','book','comic') and coast_category_enabled(${user.id}::uuid,w.category) order by pi.external_id limit 20`;
 if(!sources.length)throw new AppError(403,'Choose one playable item from your accessible source.');
 // Item-level evidence confirms this account's access before issuing the capability.
 const reading=['book','comic'].includes(sources[0].kind);
 let readingSource:Awaited<ReturnType<typeof readingShareSource>>|undefined;
 if(reading){
  if(data.target!=='website'||data.together||data.trackProgress||data.autoRevoke)throw new AppError(400,'Reading links use independent website access without owner tracking.');
  readingSource=await readingShareSource(user.id,data.workId,data.connectionId,sources[0].external_id);
 }else if(sources[0].kind==='track'){
  if(data.target==='vrchat')throw new AppError(400,'VRChat sharing requires a movie or episode.');
  if(data.trackProgress)throw new AppError(400,'Shared watch tracking requires a movie or episode.');
  await context.adapter.musicItem(context.connection.externalUserId!,sources[0].external_id);
 }else{
  let playable=false;
  for(const source of sources){
   const item=await context.adapter.itemIfAvailable(context.connection.externalUserId!,source.external_id);
   if(item&&item.access?.locationType!=='Virtual'){playable=true;break;}
  }
  if(!playable)throw new AppError(404,'Jellyfin has no playable file for this title.','playback_source_unavailable');
 }
 const token=randomToken(),expiresAt=new Date(Date.now()+data.hours*3600000);
 const [tokenHash,encryptedToken]=await Promise.all([hashToken(token),encryptCredential(token)]);
 return db.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtextextended(${user.id},0))`;
  if(readingSource){
   const [current]=await tx`select c.id from provider_connections c join users u on u.id=c.user_id join provider_instances i on i.id=c.instance_id
    where c.id=${data.connectionId} and c.user_id=${user.id} and c.account_generation=${readingSource.connection.accountGeneration}
      and c.status='connected' and i.enabled and not u.disabled and (u.role='admin' or u.settings->>'allowPlaybackSharing'='true')
      and coast_feature_enabled(u.id,'sharing') and coast_feature_enabled(u.id,'reader') and coast_category_enabled(u.id,${sources[0].kind}) for share of c,u,i`;
   if(!current)throw new AppError(410,'The shared reading source changed.');
  }
  const [count]=await tx`select count(*)::int as total from playback_shares where owner_id=${user.id} and revoked_at is null and expires_at>now()`;
  if(count.total>=20)throw new AppError(409,'Revoke an active link before creating more.');
  const [row]=await tx`insert into playback_shares(owner_id,work_id,connection_id,account_generation,token_hash,encrypted_token,together,target,video_codec,expires_at,auto_revoke,track_progress,source_id,edition) values(${user.id},${data.workId},${data.connectionId},${context.connection.accountGeneration},${tokenHash},${encryptedToken},${data.together},${data.target},${data.videoCodec},${expiresAt},${data.autoRevoke},${data.trackProgress},${readingSource?.externalId??null},${readingSource?.edition??null}) returning id`;
  return {id:row.id,token,expiresAt,target:data.target,videoCodec:data.videoCodec};
 });
}
export async function listShares(actor:SessionUser|null){const user=requireUser(actor);return getSql()`select id,work_id as "workId",together,target,video_codec as "videoCodec",expires_at as "expiresAt",claimed_at as "claimedAt",revoked_at as "revokedAt" from playback_shares where owner_id=${user.id} order by created_at desc limit 50`;}
export async function revokeShare(actor:SessionUser|null,id:string){
 const user=requireUser(actor),rows=await getSql()`update playback_shares set revoked_at=coalesce(revoked_at,now()),encrypted_token=null where id=${v.parse(uuid,id)} and owner_id=${user.id} returning id`;
 if(!rows.length)throw new AppError(404,'Link not found.');
 await (await import('./reading.server')).closeReadingShare(user.id,id);
 const viewers=await getSql()<{id:string}[]>`select id from share_viewers where share_id=${id} and ended_at is null limit 64`;
 for(let i=0;i<viewers.length;i+=2)await Promise.allSettled(viewers.slice(i,i+2).map(viewer=>releaseViewer(user.id,viewer.id)));
}
export async function claimShare(input:unknown,actor:SessionUser|null,previous?:string){
 const data=v.parse(v.strictObject({token:v.optional(v.pipe(v.string(),v.regex(/^[A-Za-z0-9_-]{43}$/))),id:v.optional(uuid)}),input);
 if(!data.token&&!data.id)throw new AppError(400,'Supply an invitation.');
 const db=getSql(),session=randomToken();
 return db.begin(async tx=>{
  const [share]=data.token?await tx`select * from playback_shares where token_hash=${await hashToken(data.token)} for update`:await tx`select * from playback_shares where id=${data.id} and owner_id=${actor?.id??null}::uuid for update`;
  if(!share)throw new AppError(404,'This playback invitation is unavailable.');
  await assertShare(share,tx);
  const host=actor?.id===share.owner_id;
  if(previous){const [existing]=await tx`select id from share_viewers where token_hash=${await hashToken(previous)} and share_id=${share.id} and host=${host}`;if(existing)return {token:previous,expiresAt:share.expires_at};}
  const [count]=await tx`select count(*)::int as total from share_viewers where share_id=${share.id}`;
  if(count.total>=64)throw new AppError(429,'This link has reached its viewer-session limit. Create a new link.');
  if(!host)await tx`update playback_shares set claimed_at=coalesce(claimed_at,now()) where id=${share.id}`;
  await tx`insert into share_viewers(share_id,token_hash,host) values(${share.id},${await hashToken(session)},${host})`;
  return {token:session,expiresAt:share.expires_at};
 });
}
export async function assertShare(share:Record<string,any>,db=getSql()){
 const [current]=await db`select s.owner_id,s.source_id,s.edition,s.revoked_at,s.expires_at,s.together,s.target,s.video_codec,w.category,w.kind,
 c.status='connected' and c.account_generation=s.account_generation and i.enabled and not u.disabled and (u.role='admin' or u.settings->>'allowPlaybackSharing'='true') and exists(select 1 from availability a join provider_items pi on pi.id=a.provider_item_id where a.user_id=u.id and a.connection_id=c.id and a.media_id=s.work_id and a.state='available' and (w.kind not in ('book','comic') or replace(lower(pi.external_id),'-','')=replace(lower(s.source_id),'-',''))) as accessible
 from playback_shares s join works w on w.id=s.work_id join provider_connections c on c.id=s.connection_id and c.user_id=s.owner_id join provider_instances i on i.id=c.instance_id join users u on u.id=s.owner_id where s.id=${share.id}`;
 if(!current)throw new AppError(410,'This invitation is unavailable.');
 const config=await getFeatureConfig(current.owner_id,db);
 if(current.revoked_at||new Date(current.expires_at)<=new Date())throw new AppError(410,'This playback invitation has expired or was revoked.');
 if(!config.allowPlaybackSharing)throw new AppError(410,'Playback sharing is no longer available for this link.');
 if(current.target==='vrchat'&&(!config.allowTranscoding||current.video_codec==='hevc'&&!config.allowVrchatHevc))throw new AppError(410,'This VRChat profile is disabled by the administrator.');
 if(!categoryEnabled(config,current.category)||current.together&&!config.experimentalParties)throw new AppError(410,'This medium is disabled.');
 if(['book','comic'].includes(current.kind)&&(!config.features.reader||current.target!=='website'||current.together||!current.source_id||!current.edition))throw new AppError(410,'This reading invitation is unavailable.');
 if(!current.accessible)throw new AppError(410,'The shared source is no longer accessible.');
}
export async function shareViewer(token?:string){
 if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new AppError(401,'Open a valid playback invitation.');
 const [row]=await getSql()`select s.*,v.id as viewer_id,v.host,v.playback_id,v.reading_session_id,w.kind,p.state as playback_state,coalesce(m.title,a.title,r.title) as title from share_viewers v join playback_shares s on s.id=v.share_id join works w on w.id=s.work_id left join media m on m.id=s.work_id left join music_works a on a.id=s.work_id left join reading_works r on r.id=s.work_id left join playback_sessions p on p.id=v.playback_id where v.token_hash=${await hashToken(token)}`;
 if(!row)throw new AppError(401,'Open a valid playback invitation.');await assertShare(row);return row;
}
export async function sharedState(token?:string){const row=await shareViewer(token);if(row.reading_session_id)await reserveViewer(row.owner_id,row.viewer_id,false,row.reading_session_id);else if(row.playback_id&&row.playback_state!=='stopped')await reserveViewer(row.owner_id,row.viewer_id);return {id:row.id,workId:row.work_id,title:row.title,mediaType:['book','comic'].includes(row.kind)?'reading':row.kind==='track'?'audio':'video',host:row.host,together:row.together,positionSeconds:row.position_seconds,durationSeconds:row.duration_seconds,paused:row.paused,updatedAt:row.updated_at,serverTime:new Date().toISOString(),expiresAt:row.expires_at};}
export async function startShared(token:string|undefined,input:unknown,signal?:AbortSignal){
 signal?.throwIfAborted();
 const viewer=await shareViewer(token);
 return prepareShared(viewer,input,signal);
}
export async function prepareShared(viewer:Awaited<ReturnType<typeof shareViewer>>,input:unknown,signal?:AbortSignal){
 signal?.throwIfAborted();
 const data=v.parse(v.record(v.string(),v.unknown()),input);
 if(data.mediaId!==viewer.work_id||data.sequence||data.sourceId||data.edition||data.expectedDuration||data.fallbackSessionId)throw new AppError(403,'This invitation grants only its selected item.');
 const maxBitrate=await reserveViewer(viewer.owner_id,viewer.viewer_id,true);
 const preparationToken=crypto.randomUUID();
 let preparedId:string|undefined;
 const [lease]=await getSql()`update share_viewers set preparing_until=now()+interval '2 minutes',preparation_token=${preparationToken} where id=${viewer.viewer_id} and (preparing_until is null or preparing_until<now()) returning id`;
 if(!lease)throw new AppError(409,'Playback is already preparing.');
 try {
 signal?.throwIfAborted();
 await stopViewerPlayback(viewer.owner_id,viewer.viewer_id);
 const [current]=await getSql()`select playback_id from share_viewers where id=${viewer.viewer_id} and preparation_token=${preparationToken} and preparing_until>now()`;
 if(!current)throw new AppError(409,'Playback preparation was superseded. Retry.');
 const playback=await startPlayback(viewer.owner_id,{...data,fromStart:true,...(viewer.together&&viewer.duration_seconds>0?{expectedDuration:viewer.duration_seconds}:{})},{id:viewer.id,viewerId:viewer.viewer_id,connectionId:viewer.connection_id,expiresAt:new Date(viewer.expires_at),maxBitrate,vrchatCodec:viewer.target==='vrchat'?viewer.video_codec:undefined,sourceId:viewer.together?viewer.source_id??undefined:undefined},signal);
 preparedId=playback.id;
 const attached=await getSql()`update share_viewers set playback_id=${playback.id} where id=${viewer.viewer_id} and preparation_token=${preparationToken} returning id`;
 if(!attached.length){await getSql()`update playback_sessions set state='stopped',cleanup_pending=true where id=${playback.id}`;throw new AppError(409,'Playback preparation was superseded. Retry.');}
 const [prepared]=await getSql()`select source_id,edition from playback_sessions where id=${playback.id}`;
 const [selected]=await getSql()`update playback_shares set duration_seconds=case when duration_seconds=0 then ${playback.durationSeconds??0} else duration_seconds end,source_id=coalesce(source_id,${prepared.source_id}),edition=coalesce(edition,${prepared.edition}) where id=${viewer.id} and revoked_at is null and expires_at>now() returning source_id`;
 if(!selected||viewer.together&&selected.source_id!==prepared.source_id){await getSql()`update playback_sessions set state='stopped' where id=${playback.id}`;throw new AppError(409,'The shared edition changed while preparing. Retry playback.');}
 await assertShare(viewer);
 signal?.throwIfAborted();
 return {...playback,url:`/api/share/playback/${playback.id}/stream`,artwork:undefined,sources:[],subtitles:playback.subtitles.map(subtitle=>({...subtitle,url:subtitle.url?.replace('/api/v1/playback/','/api/share/playback/')})),shareId:viewer.id,measureSharePlayback:viewer.target==='website'&&(viewer.auto_revoke||viewer.track_progress)&&!viewer.completed_at};
 } catch(error){
  if(preparedId)await getSql()`update playback_sessions set state='stopped',cleanup_pending=true where id=${preparedId}`;
  if(!viewer.playback_id)await releaseViewer(viewer.owner_id,viewer.viewer_id);
  throw error;
 } finally {await getSql()`update share_viewers set preparing_until=null,preparation_token=null where id=${viewer.viewer_id} and preparation_token=${preparationToken}`;}
}
export async function sharedProgress(token:string|undefined,id:string,input:unknown){
 const viewer=await shareViewer(token);
 if(viewer.playback_id!==v.parse(uuid,id))throw new AppError(403,'This playback session belongs to another viewer.');
 const data=v.parse(v.strictObject({positionSeconds:v.pipe(v.number(),v.finite(),v.minValue(0),v.maxValue(2592000)),durationSeconds:v.optional(v.pipe(v.number(),v.finite(),v.minValue(0),v.maxValue(2592000))),event:v.picklist(['start','progress','pause','stop','ended']),paused:v.optional(v.boolean()),playedSeconds:v.optional(v.pipe(v.number(),v.finite(),v.minValue(0),v.maxValue(2592000)))}),input);
 const stop=['stop','ended'].includes(data.event),paused=stop||data.event==='pause'||data.paused===true;
 const db=getSql();
 const measure=viewer.target==='website'&&(viewer.auto_revoke||viewer.track_progress)&&!viewer.completed_at;
 const [changed]=await db`update playback_sessions p set state=${stop?'stopped':paused?'paused':'active'},
 position_seconds=least(${data.positionSeconds},coalesce(p.duration_seconds,${data.positionSeconds})),updated_at=now()
 ${measure&&data.event!=='start'&&data.playedSeconds!==undefined?db`,played_seconds=greatest(p.played_seconds,least(${data.playedSeconds},coalesce(p.duration_seconds,0),extract(epoch from now()-p.created_at)*1.05+2))`:db``}
 from share_viewers v join playback_shares s on s.id=v.share_id
 where p.id=${id} and p.share_id=s.id and v.id=${viewer.viewer_id} and v.playback_id=p.id and v.ended_at is null
 and s.revoked_at is null and s.expires_at>now() and p.state<>'stopped' and p.expires_at>now()
 returning p.duration_seconds>0 and p.played_seconds>=p.duration_seconds*${shareCompletionPercent / 100} as complete`;
 if(!changed&&!stop)throw new AppError(410,'This playback session has stopped. Open the link to play again.');
 if(measure&&(changed?.complete||stop&&!changed))await completeShare(viewer.owner_id,viewer.id,id);
 if(changed&&viewer.host&&viewer.together)await db`update playback_shares set position_seconds=least(${data.positionSeconds},duration_seconds),paused=${paused},updated_at=now() where id=${viewer.id}`;
 if(stop)await releaseViewer(viewer.owner_id,viewer.viewer_id,{playbackId:id});
 return {complete:data.event==='ended'};
}
export async function sharedStream(token:string|undefined,id:string,request:Request){
 const viewer=await shareViewer(token);
 return streamForViewer(viewer,id,request,undefined,true);
}
export async function streamForViewer(viewer:Awaited<ReturnType<typeof shareViewer>>,id:string,request:Request,access?:string,validated=false){
 request.signal.throwIfAborted();
 return requestPriority.run(0,async()=>{
 if(viewer.playback_id!==v.parse(uuid,id))throw new AppError(403,'This session belongs to another viewer.');
 if(!validated)await assertShare(viewer);
 request.signal.throwIfAborted();
 if(request.method!=='HEAD') {
  await reserveViewer(viewer.owner_id,viewer.viewer_id);
  request.signal.throwIfAborted();
  await ensureSharedEncoding(viewer.owner_id,viewer.viewer_id,request.signal);
 }
 return withSharedRequest(viewer.owner_id,viewer.viewer_id,id,request,(leasedRequest,headersReceived)=>streamPlayback(viewer.owner_id,id,leasedRequest,viewer.id,{headersReceived,vrchatCodec:viewer.target==='vrchat'?viewer.video_codec:undefined,
 segmentDelivered:viewer.target==='vrchat'&&(viewer.track_progress||viewer.auto_revoke&&!viewer.completed_at)
   ?(start,length)=>recordShareSegment(viewer.owner_id,viewer.id,id,start,length):undefined,
 url:async(_path,url)=>{
  const target=new URL(url,'http://resource.invalid');
  target.pathname=access?externalShareResourcePath(id,_path):`/api/share/playback/${id}/stream`;
  if(access)target.searchParams.set('access',access);
  return target.pathname+target.search;
 }}));
 });
}
