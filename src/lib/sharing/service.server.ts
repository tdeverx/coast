import { categoryEnabled } from '$lib/experimental';
import * as v from 'valibot';
import { getSql } from '$lib/server/db';
import { getConfig } from '$lib/server/config';
import { AppError } from '$lib/server/security/errors';
import { hashToken,randomToken,requireUser,type SessionUser } from '$lib/server/auth';
import { getJellyfin } from '$lib/providers/jellyfin/connection.server';
import { startPlayback,streamPlayback } from '$lib/playback/service.server';

const uuid=v.pipe(v.string(),v.uuid());
export const shareCookie='coast_share_viewer';
export async function createShare(actor:SessionUser|null,input:unknown){
 const user=requireUser(actor),config=await getConfig();
 if(!config.allowPlaybackSharing||(user.role!=='admin'&&user.settings.allowPlaybackSharing!==true))throw new AppError(403,'Playback sharing requires administrator permission.');
 const data=v.parse(v.strictObject({workId:uuid,connectionId:uuid,hours:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(24)),6),together:v.optional(v.boolean(),false)}),input);
 if(data.together&&!config.experimentalParties)throw new AppError(400,'Synced playback is experimental. Enable it before sharing together.');
 const context=await getJellyfin(user.id,data.connectionId);
 await context.adapter.identity(context.instance.serverIdentity??undefined);
 const db=getSql(),[access]=await db`select a.id,pi.external_id from availability a join provider_items pi on pi.id=a.provider_item_id join works w on w.id=a.media_id where a.user_id=${user.id} and a.connection_id=${data.connectionId} and a.media_id=${data.workId} and a.state='available' and w.kind in ('movie','episode','track') and (w.category='screen' or (w.category='music' and ${config.experimentalMusic}) or (w.category='game' and ${config.experimentalGaming})) limit 1`;
 if(!access)throw new AppError(403,'Choose one playable item from your accessible source.');
 // Item-level evidence confirms this account's access before issuing the capability.
 if((await db`select kind from works where id=${data.workId}`)[0].kind==='track')await context.adapter.musicItem(context.connection.externalUserId!,access.external_id);
 else await context.adapter.item(context.connection.externalUserId!,access.external_id);
 const token=randomToken(),expiresAt=new Date(Date.now()+data.hours*3600000);
 return db.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtextextended(${user.id},0))`;
  const [count]=await tx`select count(*)::int as total from playback_shares where owner_id=${user.id} and revoked_at is null and expires_at>now()`;
  if(count.total>=20)throw new AppError(409,'Revoke an active link before creating more.');
  const [row]=await tx`insert into playback_shares(owner_id,work_id,connection_id,account_generation,token_hash,together,expires_at) values(${user.id},${data.workId},${data.connectionId},${context.connection.accountGeneration},${await hashToken(token)},${data.together},${expiresAt}) returning id`;
  return {id:row.id,token,expiresAt};
 });
}
export async function listShares(actor:SessionUser|null){const user=requireUser(actor);return getSql()`select id,work_id as "workId",together,expires_at as "expiresAt",claimed_at as "claimedAt",revoked_at as "revokedAt" from playback_shares where owner_id=${user.id} order by created_at desc limit 50`;}
export async function revokeShare(actor:SessionUser|null,id:string){const user=requireUser(actor);const rows=await getSql()`update playback_shares set revoked_at=coalesce(revoked_at,now()) where id=${v.parse(uuid,id)} and owner_id=${user.id} returning id`;if(!rows.length)throw new AppError(404,'Link not found.');}
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
  if(!host&&share.claimed_at)throw new AppError(410,'This single-use invitation has already been claimed.');
  if(!host)await tx`update playback_shares set claimed_at=now() where id=${share.id}`;
  await tx`insert into share_viewers(share_id,token_hash,host) values(${share.id},${await hashToken(session)},${host})`;
  return {token:session,expiresAt:share.expires_at};
 });
}
async function assertShare(share:Record<string,any>,db=getSql()){
 const config=await getConfig(db);
 const [work]=await db`select category from works where id=${share.work_id}`;
 if(!work||(!categoryEnabled(config,work.category)||share.together&&!config.experimentalParties))throw new AppError(410,'This medium is disabled.');
 if(!config.allowPlaybackSharing||share.revoked_at||new Date(share.expires_at)<=new Date())throw new AppError(410,'This playback invitation has expired or was revoked.');
 const [access]=await db`select c.id from provider_connections c join provider_instances i on i.id=c.instance_id join users u on u.id=c.user_id where c.id=${share.connection_id} and c.user_id=${share.owner_id} and c.account_generation=${share.account_generation} and c.status='connected' and i.enabled and not u.disabled and (u.role='admin' or u.settings->>'allowPlaybackSharing'='true') and exists(select 1 from availability a where a.user_id=u.id and a.connection_id=c.id and a.media_id=${share.work_id} and a.state='available')`;
 if(!access)throw new AppError(410,'The shared source is no longer accessible.');
}
export async function shareViewer(token?:string){
 if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new AppError(401,'Open a valid playback invitation.');
 const [row]=await getSql()`select s.*,v.id as viewer_id,v.host,v.playback_id,coalesce(m.title,a.title) as title from share_viewers v join playback_shares s on s.id=v.share_id left join media m on m.id=s.work_id left join music_works a on a.id=s.work_id where v.token_hash=${await hashToken(token)}`;
 if(!row)throw new AppError(401,'Open a valid playback invitation.');await assertShare(row);return row;
}
export async function sharedState(token?:string){const row=await shareViewer(token);return {id:row.id,workId:row.work_id,title:row.title,host:row.host,together:row.together,positionSeconds:row.position_seconds,durationSeconds:row.duration_seconds,paused:row.paused,updatedAt:row.updated_at,serverTime:new Date().toISOString(),expiresAt:row.expires_at};}
export async function startShared(token:string|undefined,input:unknown){
 const viewer=await shareViewer(token);
 const data=v.parse(v.record(v.string(),v.unknown()),input);
 if(data.mediaId!==viewer.work_id||data.sequence||data.sourceId||data.edition||data.expectedDuration)throw new AppError(403,'This invitation grants only its selected item.');
 const [lease]=await getSql()`update share_viewers set preparing_until=now()+interval '2 minutes' where id=${viewer.viewer_id} and (preparing_until is null or preparing_until<now()) returning id`;
 if(!lease)throw new AppError(409,'Playback is already preparing.');
 try {
 const playback=await startPlayback(viewer.owner_id,{...data,fromStart:true,...(viewer.together&&viewer.duration_seconds>0?{expectedDuration:viewer.duration_seconds}:{})},{id:viewer.id,connectionId:viewer.connection_id,expiresAt:new Date(viewer.expires_at),sourceId:viewer.together?viewer.source_id??undefined:undefined});
 if(viewer.playback_id)await getSql()`update playback_sessions set state='stopped',updated_at=now() where id=${viewer.playback_id} and share_id=${viewer.id}`;
 await getSql()`update share_viewers set playback_id=${playback.id} where id=${viewer.viewer_id}`;
 const [prepared]=await getSql()`select source_id,edition from playback_sessions where id=${playback.id}`;
 const [selected]=await getSql()`update playback_shares set duration_seconds=case when duration_seconds=0 then ${playback.durationSeconds??0} else duration_seconds end,source_id=coalesce(source_id,${prepared.source_id}),edition=coalesce(edition,${prepared.edition}) where id=${viewer.id} and revoked_at is null and expires_at>now() returning source_id`;
 if(!selected||viewer.together&&selected.source_id!==prepared.source_id){await getSql()`update playback_sessions set state='stopped' where id=${playback.id}`;throw new AppError(409,'The shared edition changed while preparing. Retry playback.');}
 await shareViewer(token);
 return {...playback,url:`/api/share/playback/${playback.id}/stream`,artwork:undefined,sources:[],subtitles:playback.subtitles.map(subtitle=>({...subtitle,url:subtitle.url?.replace('/api/v1/playback/','/api/share/playback/')})),shareId:viewer.id};
 } finally {await getSql()`update share_viewers set preparing_until=null where id=${viewer.viewer_id}`;}
}
export async function sharedProgress(token:string|undefined,id:string,input:unknown){
 const viewer=await shareViewer(token);
 if(viewer.playback_id!==v.parse(uuid,id))throw new AppError(403,'This playback session belongs to another viewer.');
 const data=v.parse(v.strictObject({positionSeconds:v.pipe(v.number(),v.finite(),v.minValue(0),v.maxValue(2592000)),durationSeconds:v.optional(v.pipe(v.number(),v.finite(),v.minValue(0),v.maxValue(2592000))),event:v.picklist(['start','progress','pause','stop','ended']),paused:v.optional(v.boolean()),playedSeconds:v.optional(v.pipe(v.number(),v.finite(),v.minValue(0),v.maxValue(2592000)))}),input);
 const stop=['stop','ended'].includes(data.event),paused=stop||data.event==='pause'||data.paused===true;
 await getSql()`update playback_sessions set state=${stop?'stopped':paused?'paused':'active'},position_seconds=least(${data.positionSeconds},coalesce(duration_seconds,${data.positionSeconds})),updated_at=now() where id=${id} and share_id=${viewer.id}`;
 if(viewer.host&&viewer.together)await getSql()`update playback_shares set position_seconds=least(${data.positionSeconds},duration_seconds),paused=${paused},updated_at=now() where id=${viewer.id}`;
 return {complete:data.event==='ended'};
}
export async function sharedStream(token:string|undefined,id:string,request:Request){const viewer=await shareViewer(token);if(viewer.playback_id!==v.parse(uuid,id))throw new AppError(403,'This session belongs to another viewer.');const response=await streamPlayback(viewer.owner_id,id,request,viewer.id);if(response.headers.get('content-type')?.includes('mpegurl')){const body=(await response.text()).replaceAll('/api/v1/playback/','/api/share/playback/');response.headers.delete('content-length');return new Response(body,{status:response.status,headers:response.headers});}return response;}
