import * as v from 'valibot';
import { getSql } from '$lib/server/db';
import { hashToken, randomToken } from '$lib/server/auth';
import { encryptCredential, decryptCredential } from '$lib/server/security/credentials';
import { AppError } from '$lib/server/security/errors';
import { assertShare, prepareShared, streamForViewer } from './service.server';
import { shareTokenPattern, wantsSharePage } from './policy';

const headers={'cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','vary':'Accept'};
const capability=v.strictObject({viewerId:v.pipe(v.string(),v.uuid()),shareId:v.pipe(v.string(),v.uuid()),expiresAt:v.number()});

/** The copied URL resolves to a browser landing page or a cookie-free media playlist. */
export async function openPublicShare(token:string,request:Request,address:string) {
 request.signal.throwIfAborted();
 if(!shareTokenPattern.test(token))throw new AppError(404,'This playback link is unavailable.');
 const db=getSql(),[share]=await db`select * from playback_shares where token_hash=${await hashToken(token)}`;
 if(!share)throw new AppError(404,'This playback link is unavailable.');
 await assertShare(share);
 if(wantsSharePage(request)&&new URL(request.url).searchParams.get('play')!=='1')return new Response(null,{status:302,headers:{...headers,location:`/share#invite=${token}`}});
 // Probes must not consume bandwidth slots or launch encoders.
 if(request.method==='HEAD')return new Response(null,{headers:{...headers,'content-type':'application/vnd.apple.mpegurl'}});
 if(share.together)throw new AppError(400,'Together playback uses the browser player. Create an independent link for external players.');
 // Approximate identity for clients that cannot keep cookies. Never store raw addresses or user agents.
 const fingerprint=await hashToken(`${share.token_hash}\0${address}\0${(request.headers.get('user-agent')??'').slice(0,256)}`);
 const viewer=await db.begin(async tx=>{
  const [locked]=await tx`select * from playback_shares where id=${share.id} for update`;
  if(!locked)throw new AppError(410,'This playback link has expired.');
  await assertShare(locked,tx);
  const [existing]=await tx`select id,playback_id from share_viewers where share_id=${share.id} and fingerprint=${fingerprint}`;
  if(existing)return existing;
  const [count]=await tx`select count(*)::int as total from share_viewers where share_id=${share.id}`;
  if(count.total>=64)throw new AppError(429,'This link has reached its viewer-session limit.');
  const [created]=await tx`insert into share_viewers(share_id,token_hash,fingerprint,client) values(${share.id},${await hashToken(randomToken())},${fingerprint},'External player') returning id,playback_id`;
  await tx`update playback_shares set claimed_at=coalesce(claimed_at,now()) where id=${share.id}`;
  return created;
 });
 const context={...share,viewer_id:viewer.id,playback_id:viewer.playback_id,host:false};
 if(!context.playback_id||(await db`select id from playback_sessions where id=${context.playback_id} and state<>'stopped' and expires_at>now()`).length===0) {
  const playback=await prepareShared(context,{mediaId:share.work_id,fromStart:true,browser:{containers:[],videoCodecs:['h264'],audioCodecs:['aac'],nativeHls:true,hlsJs:false,maxWidth:1280}},request.signal);
  context.playback_id=playback.id;
 }
 const access=await encryptCredential(JSON.stringify({viewerId:viewer.id,shareId:share.id,expiresAt:new Date(share.expires_at).getTime()}));
 const target=new URL(`/api/share/external/${context.playback_id}/stream`,request.url);
 target.searchParams.set('access',access);
 return streamForViewer(context,context.playback_id,new Request(target,{headers:request.headers,signal:request.signal}),access);
}

export async function externalStream(id:string,request:Request) {
 const access=new URL(request.url).searchParams.get('access');
 if(!access||access.length>4096)throw new AppError(401,'Open a valid playback link.');
 let grant:v.InferOutput<typeof capability>;
 try {grant=v.parse(capability,JSON.parse(await decryptCredential(access)));}
 catch {throw new AppError(403,'Invalid viewer resource.');}
 if(grant.expiresAt<=Date.now())throw new AppError(410,'This playback link has expired.');
 const [viewer]=await getSql()`select s.*,v.id as viewer_id,v.playback_id,v.host from share_viewers v join playback_shares s on s.id=v.share_id where v.id=${grant.viewerId} and s.id=${grant.shareId}`;
 if(!viewer)throw new AppError(410,'This viewer session has expired.');
 return streamForViewer(viewer,id,request,access);
}
