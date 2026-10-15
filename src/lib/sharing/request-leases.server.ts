import { getSql } from '$lib/server/db';
import { AppError } from '$lib/server/security/errors';

/** Short row locks admit parallel dispatches; no provider I/O holds a transaction. */
export async function withSharedRequest(
  ownerId:string,viewerId:string,playbackId:string,request:Request,
  dispatch:(request:Request,headersReceived:()=>Promise<void>)=>Promise<Response>
) {
  // A worker must abort dispatch before its durable lease can expire after a crash.
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new DOMException('Stream preparation timed out.','TimeoutError')),25_000);
  const signal=AbortSignal.any([request.signal,deadline.signal]);
  try {
  const db=getSql(),id=crypto.randomUUID();
  while(true){
    signal.throwIfAborted();
    const admitted=await db.begin(async tx=>{
      const [viewer]=await tx`select v.preparing_until,p.state,p.expires_at,v.ended_at from share_viewers v join playback_shares s on s.id=v.share_id join playback_sessions p on p.id=v.playback_id where v.id=${viewerId} and s.owner_id=${ownerId} and p.id=${playbackId} for update of v`;
      if(!viewer||viewer.state==='stopped'||viewer.ended_at||new Date(viewer.expires_at)<=new Date())throw new AppError(410,'The viewer playback session has expired.');
      if(viewer.preparing_until&&new Date(viewer.preparing_until)>new Date())return false;
      await tx`delete from share_request_leases where viewer_id=${viewerId} and expires_at<=now()`;
      const [active]=await tx`select count(*)::int as total from share_request_leases where viewer_id=${viewerId}`;
      if(active.total>=8)return false;
      signal.throwIfAborted();
      await tx`insert into share_request_leases(id,viewer_id,playback_id,expires_at) values(${id},${viewerId},${playbackId},now()+interval '35 seconds')`;
      return true;
    });
    if(admitted)break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  let released=false;
  async function release(){clearTimeout(timer);if(!released){await db`delete from share_request_leases where id=${id}`;released=true;}}
  try{
    signal.throwIfAborted();
    return await dispatch(new Request(request,{signal}),release);
  }finally{await release();}
  }finally{clearTimeout(timer);}
}

/** Call only after stopping the session or fencing new dispatches with its preparation token. */
export async function waitSharedRequests(playbackId:string) {
  const db=getSql(),deadline=Date.now()+40_000;
  while(true){
    await db`delete from share_request_leases where playback_id=${playbackId} and expires_at<=now()`;
    const [active]=await db`select id from share_request_leases where playback_id=${playbackId} limit 1`;
    if(!active)return;
    if(Date.now()>=deadline)throw new AppError(503,'Previous stream requests are still finishing. Retry shortly.');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
}
