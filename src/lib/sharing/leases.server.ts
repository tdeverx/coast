import { getSql } from '#lib/server/db/index.js';
import { getConfig } from '#lib/server/config.js';
import { AppError } from '#lib/server/security/errors.js';
import { getJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import {logDiagnostic,classifyFailure} from '#lib/server/diagnostics/index.js';
import { waitSharedRequests, waitSharedRetry } from './request-leases.server';
import { encodingBitrate, playbackLimits, viewerIdleSeconds } from './policy';
import {allocateViewers} from './allocation';

/** Short owner-scoped transactions allocate all links together. No provider I/O holds a DB lock. */
export async function reserveViewer(ownerId:string,viewerId:string,force=false) {
  const db=getSql();
  if(!force){
    const [recent]=await db`select v.desired_bitrate from share_viewers v join playback_shares s on s.id=v.share_id join playback_sessions p on p.id=v.playback_id where v.id=${viewerId} and s.owner_id=${ownerId} and v.ended_at is null and v.last_seen_at>now()-interval '10 seconds' and p.state<>'stopped'`;
    if(recent?.desired_bitrate)return recent.desired_bitrate as number;
  }
  const config=await getConfig();
  const result=await db.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtextextended(${'sharing:'+ownerId},0))`;
    const [owner]=await tx`select settings from users where id=${ownerId} and not disabled`;
    if(!owner)throw new AppError(410,'The shared account is unavailable.');
    const [viewer]=await tx`select v.id,s.target,v.last_seen_at,v.ended_at,v.desired_bitrate,p.state as playback_state from share_viewers v join playback_shares s on s.id=v.share_id left join playback_sessions p on p.id=v.playback_id where v.id=${viewerId} and s.owner_id=${ownerId}`;
    if(!viewer||!force&&viewer.playback_state==='stopped')throw new AppError(410,'The viewer playback session has expired.');
    if(!force&&viewer.last_seen_at&&!viewer.ended_at&&Date.now()-new Date(viewer.last_seen_at).getTime()<10_000)return {bitrate:viewer.desired_bitrate as number,cleanup:[]};
    const budget=playbackLimits(config.maxBitrateMbps,owner.settings).shared;
    const active=await tx<{id:string;target:'website'|'vrchat';desired_bitrate:number|null}[]>`select v.id,s.target,v.desired_bitrate from share_viewers v join playback_shares s on s.id=v.share_id where s.owner_id=${ownerId} and s.revoked_at is null and s.expires_at>now() and v.ended_at is null and v.last_seen_at>now()-${viewerIdleSeconds}*interval '1 second' order by v.created_at,v.id limit 21`;
    const rates=allocateViewers(budget,active,viewer,playbackLimits(config.maxBitrateMbps,owner.settings).personal);
    const excess=active.filter(row=>!rates.has(row.id)).map(row=>row.id);
    const cleanup=excess.length?await tx<ReleasedSession[]>`with ended as (
      update share_viewers set ended_at=now(),desired_bitrate=null where id in ${tx(excess)} returning playback_id
    ) update playback_sessions set state='stopped',cleanup_pending=true,updated_at=now() where id in (select playback_id from ended) returning id,user_id,connection_id,provider_device_id,provider_session_id`:[];
    const admitted=rates.has(viewerId);
    if(admitted)await tx`update share_viewers set last_seen_at=now(),ended_at=null where id=${viewerId}`;
    if(rates.size){
      const allocations=[...rates].map(([id,rate])=>({id,rate}));
      await tx`update share_viewers v set desired_bitrate=r.rate from jsonb_to_recordset(${JSON.stringify(allocations)}::text::jsonb) as r(id uuid,rate integer) where v.id=r.id`;
    }
    return {bitrate:rates.get(viewerId)??0,cleanup};
  });
  // Commit evictions even if this caller is over capacity. Provider I/O never holds the owner lock.
  for(const session of result.cleanup){try{await stopReleasedSession(session);}catch{/* Durable retry remains pending. */}}
  if(!result.bitrate)throw new AppError(429,'The shared playback bandwidth is full. Try again after a viewer leaves.');
  return result.bitrate;
}

/** A durable lease serializes generation changes across processes and survives interrupted requests. */
export async function ensureSharedEncoding(ownerId:string,viewerId:string,signal?:AbortSignal) {
  signal?.throwIfAborted();
  const db=getSql(),deadline=Date.now()+25_000;
  let retry=50;
  while(Date.now()<deadline) {
    signal?.throwIfAborted();
    const [row]=await db`select v.desired_bitrate,v.preparing_until,p.* from share_viewers v join playback_sessions p on p.id=v.playback_id where v.id=${viewerId} and p.user_id=${ownerId} and p.state<>'stopped' and p.expires_at>now()`;
    signal?.throwIfAborted();
    if(!row)throw new AppError(410,'The viewer playback session has expired.');
    if(row.preparing_until&&new Date(row.preparing_until)>new Date()) {await waitSharedRetry(retry,signal);retry=Math.min(250,retry*2);continue;}
    if(!row.provider_device_id||!row.provider_session_id||!row.desired_bitrate)return;
    const desired=Math.min(row.desired_bitrate,row.bitrate_ceiling??row.desired_bitrate);
    const bitrate=encodingBitrate(row.max_bitrate??desired,desired);
    if(bitrate===row.max_bitrate)return;
    const [lease]=await db`update share_viewers set preparing_until=now()+interval '2 minutes',preparation_token=${crypto.randomUUID()} where id=${viewerId} and desired_bitrate=${row.desired_bitrate} and (preparing_until is null or preparing_until<now()) and exists(select 1 from playback_sessions p where p.id=playback_id and p.provider_session_id=${row.provider_session_id} and p.max_bitrate=${row.max_bitrate}) returning preparation_token`;
    if(!lease){await waitSharedRetry(retry,signal);retry=Math.min(250,retry*2);continue;}
    try {
      await waitSharedRequests(row.id,signal);
      signal?.throwIfAborted();
      const {adapter}=await getJellyfin(ownerId,row.connection_id);
      signal?.throwIfAborted();
      // Once the encoder is stopped, finish publishing its replacement generation even
      // if the caller departs; the next request must never reuse the stopped encoder.
      await adapter.stopEncoding(row.provider_device_id,row.provider_session_id);
      const updated=await db`update playback_sessions p set provider_session_id=${crypto.randomUUID()},max_bitrate=${bitrate},updated_at=now() where p.id=${row.id} and p.state<>'stopped' and exists(select 1 from share_viewers v join playback_shares s on s.id=v.share_id where v.id=${viewerId} and v.playback_id=p.id and v.preparation_token=${lease.preparation_token} and s.revoked_at is null and s.expires_at>now()) returning p.id`;
      if(!updated.length)throw new AppError(410,'The shared playback session has expired.');
      signal?.throwIfAborted();
      return;
    } finally {await db`update share_viewers set preparing_until=null,preparation_token=null where id=${viewerId} and preparation_token=${lease.preparation_token}`;}
  }
  throw new AppError(503,'The stream is changing quality. Retry shortly.');
}
type ReleasedSession={id:string;user_id:string;connection_id:string;provider_device_id:string|null;provider_session_id:string|null};
async function stopReleasedSession(session:ReleasedSession) {
  try {
    await waitSharedRequests(session.id);
    if(session.provider_device_id&&session.provider_session_id) {
      const {adapter}=await getJellyfin(session.user_id,session.connection_id);
      await adapter.stopEncoding(session.provider_device_id,session.provider_session_id);
    }
    await getSql()`update playback_sessions set cleanup_pending=false where id=${session.id} and state='stopped'`;
  } catch(error) {
    void logDiagnostic('warn','playback.failed',{sessionId:session.id,stage:'share-cleanup',failure:classifyFailure(error)});
    throw error;
  }
}

/** Fence the current generation, then drain known encoders before allowing another start. */
export async function stopViewerPlayback(ownerId:string,viewerId:string) {
  const db=getSql();
  await db`update playback_sessions p set state='stopped',cleanup_pending=true,updated_at=now()
    where p.user_id=${ownerId} and p.state<>'stopped' and p.id in (select v.playback_id from share_viewers v join playback_shares s on s.id=v.share_id where v.id=${viewerId} and s.owner_id=${ownerId})`;
  // Failed cleanup consumes resources too. A replacement must not outrun the owner's retry backlog.
  const pending=await db<ReleasedSession[]>`select id,user_id,connection_id,provider_device_id,provider_session_id from playback_sessions where user_id=${ownerId} and share_id is not null and cleanup_pending and state='stopped' order by created_at,id limit 20`;
  for(const session of pending)await stopReleasedSession(session);
  const [remaining]=await db`select id from playback_sessions where user_id=${ownerId} and share_id is not null and cleanup_pending limit 1`;
  if(remaining)throw new AppError(503,'Previous shared playback is still stopping. Retry shortly.');
}
export async function releaseViewer(ownerId:string,viewerId:string,idleOnly=false) {
  const db=getSql();
  const [session]=await db`with ended as (
    update share_viewers v set ended_at=now() from playback_shares s where v.id=${viewerId} and s.id=v.share_id and s.owner_id=${ownerId} and v.ended_at is null
    ${idleOnly?db`and (v.last_seen_at<now()-interval '90 seconds' or s.revoked_at is not null or s.expires_at<=now())`:db``} returning v.playback_id
  ) update playback_sessions set state='stopped',cleanup_pending=true,updated_at=now() where id in (select playback_id from ended) and user_id=${ownerId} returning id,user_id,connection_id,provider_device_id,provider_session_id`;
  if(session)await stopReleasedSession(session);
}

/** Lifecycle cleanup, including developer mode. Failed provider stops remain durable and retryable. */
export async function expireSharedViewers() {
 const db=getSql();
 await db`delete from share_request_leases where id in (select id from share_request_leases where expires_at<=now() limit 200)`;
 const rows=await db`select v.id,s.owner_id from share_viewers v join playback_shares s on s.id=v.share_id where v.ended_at is null and v.playback_id is not null and (v.last_seen_at<now()-interval '90 seconds' or s.revoked_at is not null or s.expires_at<=now()) order by v.last_seen_at limit 20`;
 for(const row of rows) {
  try {await releaseViewer(row.owner_id,row.id,true);} catch { /* The durable cleanup flag is retried below. */ }
 }
 const pending=await db`update playback_sessions set cleanup_attempted_at=now() where id in (select id from playback_sessions where cleanup_pending and state='stopped' order by cleanup_attempted_at nulls first limit 20) returning id,user_id,connection_id,provider_device_id,provider_session_id`;
 for(const session of pending){try{await stopReleasedSession(session);}catch{/* Retain failed stops for the next bounded lifecycle pass. */}}
}
