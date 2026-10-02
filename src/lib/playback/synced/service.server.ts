import * as v from 'valibot';
import {getSql} from '$lib/server/db';
import {getConfig} from '$lib/server/config';
import {requireExperimentalFeatures} from '$lib/server/experimental';
import {AppError} from '$lib/server/security/errors';
import {requireFriend} from '$lib/social/service.server';
import {notify} from '$lib/server/notifications';
import {compatibleSource} from './model';
import type {RoomState} from './model';
const uuid=v.pipe(v.string(),v.uuid());
const position=v.pipe(v.number(),v.minValue(0),v.maxValue(604800));
async function enabled(){requireExperimentalFeatures(await getConfig());}
async function authorized(userId:string,id:string){
  await enabled();
  const [room]=await getSql()`SELECT r.* FROM synced_rooms r JOIN synced_participants p ON p.room_id=r.id
    JOIN users h ON h.id=r.host_id JOIN users viewer ON viewer.id=p.user_id WHERE r.id=${v.parse(uuid,id)} AND p.user_id=${userId} AND NOT h.disabled AND NOT viewer.disabled`;
  if(!room)throw new AppError(404,'Synced session not found.');
  if(room.host_id!==userId)await requireFriend(userId,room.host_id);
  return room;
}
async function playback(userId:string,id:string){
  const [p]=await getSql()`SELECT p.* FROM playback_sessions p JOIN provider_connections c ON c.id=p.connection_id JOIN provider_instances i ON i.id=c.instance_id
    WHERE p.id=${v.parse(uuid,id)} AND p.user_id=${userId} AND p.expires_at>NOW() AND p.state<>'stopped' AND c.status='connected' AND i.enabled`;
  if(!p)throw new AppError(409,'Prepare your own playable source before joining.');
  return p;
}
function descriptor(p:Record<string,any>){return {mediaId:p.media_id,mediaType:p.media_type,edition:p.edition||'',durationSeconds:Number(p.duration_seconds)};}
async function leaveOthers(sql:ReturnType<typeof getSql>,userId:string,except:string){
  await sql`UPDATE synced_participants SET joined=FALSE,buffering=FALSE,playback_id=NULL WHERE user_id=${userId} AND room_id<>${except}`;
  await sql`UPDATE synced_rooms SET ended_at=NOW(),revision=revision+1 WHERE host_id=${userId} AND id<>${except} AND ended_at IS NULL`;
}
export async function createRoom(userId:string,input:unknown){
  await enabled();
  const data=v.parse(v.object({playbackId:uuid,positionSeconds:position,queue:v.optional(v.pipe(v.array(uuid),v.maxLength(200)),[]),queueIndex:v.optional(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(199)),0)}),input);
  const p=await playback(userId,data.playbackId);
  if(!(p.duration_seconds>0))throw new AppError(409,'This source has no duration and cannot be synchronized.');
  const queue=p.media_type==='audio'?data.queue:[];
  if(queue.length && queue[data.queueIndex]!==p.media_id)throw new AppError(400,'The current track must belong to the shared queue.');
  if(queue.length){const [invalid]=await getSql()`SELECT count(*)::int AS count FROM unnest(${getSql().array(queue,'TEXT')}::uuid[]) q(id) LEFT JOIN works w ON w.id=q.id WHERE w.kind IS DISTINCT FROM 'track'`;if(invalid.count)throw new AppError(400,'Choose music tracks for the shared queue.');}
  const id=crypto.randomUUID();
  await getSql().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`synced-user:${userId}`},0))`;
    await leaveOthers(sql,userId,id);
    await sql`INSERT INTO synced_rooms (id,host_id,media_id,media_type,edition,duration_seconds,position_seconds,queue,queue_index)
      VALUES (${id},${userId},${p.media_id},${p.media_type},${p.edition||''},${p.duration_seconds},${Math.min(data.positionSeconds,p.duration_seconds)},${queue}::jsonb,${data.queueIndex})`;
    await sql`INSERT INTO synced_participants (room_id,user_id,playback_id,joined,heartbeat_at) VALUES (${id},${userId},${p.id},TRUE,NOW())`;
  });
  return roomState(userId,id);
}
export async function inviteParticipant(userId:string,id:string,input:unknown){
  const room=await authorized(userId,id);
  if(room.host_id!==userId||room.ended_at)throw new AppError(403,'Only the host can invite friends to an active session.');
  const {friendId}=v.parse(v.object({friendId:uuid}),input);await requireFriend(userId,friendId);
  await getSql().begin(async sql=>{
    const [r]=await sql`SELECT id FROM synced_rooms WHERE id=${id} AND ended_at IS NULL FOR UPDATE`;
    if(!r)throw new AppError(409,'This session has ended.');
    const [count]=await sql`SELECT count(*)::int AS total FROM synced_participants WHERE room_id=${id}`;
    if(count.total>=16)throw new AppError(409,'This session already has 16 participants.');
    await sql`INSERT INTO synced_participants (room_id,user_id) VALUES (${id},${friendId}) ON CONFLICT DO NOTHING`;
    await notify({userId:friendId,kind:'synced-invite',title:'Join a synced session',sourceKey:`synced:${id}`,data:{actorId:userId,subjectId:id,destination:`/synced/${id}`}},sql);
  });return {invited:true};
}
export async function joinRoom(userId:string,id:string,input:unknown){
  const room=await authorized(userId,id);
  const {playbackId,revision}=v.parse(v.object({playbackId:uuid,revision:v.pipe(v.number(),v.integer())}),input);
  const p=await playback(userId,playbackId);
  if(!compatibleSource(descriptor(room),descriptor(p)))throw new AppError(409,'Your source has a different edition or duration. Choose a matching version to join.');
  await getSql().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`synced-user:${userId}`},0))`;
    const [r]=await sql`SELECT revision FROM synced_rooms WHERE id=${id} AND ended_at IS NULL AND created_at>NOW()-INTERVAL '24 hours' FOR UPDATE`;
    if(!r||r.revision!==revision)throw new AppError(409,'The session changed while preparing. Refresh and try again.');
    await leaveOthers(sql,userId,id);
    await sql`UPDATE synced_participants SET playback_id=${p.id},joined=TRUE,buffering=FALSE,heartbeat_at=NOW() WHERE room_id=${id} AND user_id=${userId}`;
  });return roomState(userId,id);
}
export async function roomState(userId:string,id:string,input?:unknown):Promise<RoomState>{
  await authorized(userId,id);
  const heartbeat=input===undefined?null:v.parse(v.object({buffering:v.boolean()}),input);
  return getSql().begin(async sql=>{
    const [r]=await sql`SELECT * FROM synced_rooms WHERE id=${id} FOR UPDATE`;
    if(heartbeat)await sql`UPDATE synced_participants SET heartbeat_at=NOW(),buffering=${heartbeat.buffering} WHERE room_id=${id} AND user_id=${userId} AND joined`;
    // Friendship removal and disabled accounts revoke session participation too.
    await sql`UPDATE synced_participants p SET joined=FALSE,buffering=FALSE WHERE p.room_id=${id} AND p.user_id<>${r.host_id} AND (EXISTS(SELECT 1 FROM users u WHERE u.id=p.user_id AND u.disabled) OR NOT EXISTS(SELECT 1 FROM friendships f WHERE f.user_a=least(p.user_id,${r.host_id}::uuid) AND f.user_b=greatest(p.user_id,${r.host_id}::uuid) AND f.state='accepted'))`;
    await sql`UPDATE synced_participants p SET joined=FALSE,buffering=FALSE WHERE p.room_id=${id} AND p.playback_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM playback_sessions b JOIN provider_connections c ON c.id=b.connection_id JOIN provider_instances i ON i.id=c.instance_id
      WHERE b.id=p.playback_id AND b.user_id=p.user_id AND b.expires_at>NOW() AND c.status='connected' AND i.enabled)`;
    const members:RoomState['participants']=await sql`SELECT p.user_id AS "userId",u.username,p.joined,p.buffering,(p.heartbeat_at>NOW()-INTERVAL '15 seconds') AS online FROM synced_participants p JOIN users u ON u.id=p.user_id WHERE p.room_id=${id} ORDER BY p.user_id`;
    const queueItems= r.media_type==='audio' ? await sql`SELECT q.id,coalesce(m.title,'Unknown track') AS title,CASE WHEN EXISTS(SELECT 1 FROM availability a JOIN provider_connections c ON c.id=a.connection_id JOIN provider_instances i ON i.id=c.instance_id WHERE a.media_id=q.id AND a.user_id=${userId} AND a.state='available' AND c.status='connected' AND i.enabled) THEN 'available' ELSE 'unknown' END AS availability
      FROM unnest(${sql.array(r.queue,'TEXT')}::uuid[]) WITH ORDINALITY q(id,ordinal) LEFT JOIN music_works m ON m.id=q.id ORDER BY q.ordinal` : [];
    const hostOnline=members.some(p=>p.userId===r.host_id&&p.joined&&p.online);
    const blocked=!hostOnline||(r.buffering_policy==='together'&&members.some(p=>p.joined&&p.online&&p.buffering));
    if(!r.ended_at&&(blocked!==r.buffering_paused||new Date(r.created_at).getTime()<Date.now()-86400000)){
      const now=new Date();
      const pos=Math.min(r.duration_seconds,r.position_seconds+(!r.paused&&!r.buffering_paused?Math.max(0,now.getTime()-new Date(r.updated_at).getTime())/1000:0));
      const expired=new Date(r.created_at).getTime()<Date.now()-86400000;
      await sql`UPDATE synced_rooms SET position_seconds=${pos},buffering_paused=${blocked},updated_at=${now},revision=revision+1,ended_at=${expired?now:null} WHERE id=${id}`;
      Object.assign(r,{position_seconds:pos,buffering_paused:blocked,updated_at:now,revision:r.revision+1,ended_at:expired?now:null});
    }
    return {id:r.id,hostId:r.host_id,mediaId:r.media_id,mediaType:r.media_type,edition:r.edition,durationSeconds:r.duration_seconds,positionSeconds:r.position_seconds,paused:r.paused,bufferingPaused:r.buffering_paused,bufferingPolicy:r.buffering_policy,queue:r.queue,queueIndex:r.queue_index,queueItems,revision:r.revision,updatedAt:new Date(r.updated_at).toISOString(),serverTime:new Date().toISOString(),ended:!!r.ended_at,participants:members.map(p=>({...p,online:!!p.online}))} as RoomState;
  });
}
export async function commandRoom(userId:string,id:string,input:unknown){
  const room=await authorized(userId,id);
  if(room.host_id!==userId)throw new AppError(403,'Playback is controlled by the host.');
  const data=v.parse(v.object({revision:v.pipe(v.number(),v.integer()),action:v.picklist(['play','pause','seek','policy','item','end']),positionSeconds:v.optional(position),policy:v.optional(v.picklist(['together','catch-up'])),playbackId:v.optional(uuid),queueIndex:v.optional(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(199))),queue:v.optional(v.pipe(v.array(uuid),v.maxLength(200)))}),input);
  const p=data.action==='item'&&data.playbackId?await playback(userId,data.playbackId):null;
  if(data.action==='item'&&!p)throw new AppError(400,'Prepare the next item first.');
  const queue=data.queue??room.queue;
  if(p&&(!(p.duration_seconds>0)||p.media_type!==room.media_type||room.media_type==='audio'&&queue[data.queueIndex??room.queue_index]!==p.media_id))throw new AppError(409,'Choose a compatible item in this shared queue.');
  if(p&&p.media_type==='audio'&&data.queue){const [invalid]=await getSql()`SELECT count(*)::int AS count FROM unnest(${getSql().array(queue,'TEXT')}::uuid[]) q(id) LEFT JOIN works w ON w.id=q.id WHERE w.kind IS DISTINCT FROM 'track'`;if(invalid.count)throw new AppError(400,'Choose music tracks for the shared queue.');}
  await getSql().begin(async sql=>{
    const [r]=await sql`SELECT * FROM synced_rooms WHERE id=${id} FOR UPDATE`;
    if(r.ended_at||r.revision!==data.revision)throw new AppError(409,'The session changed. Refresh before changing playback.');
    const now=new Date();let pos=Math.min(r.duration_seconds,r.position_seconds+(!r.paused&&!r.buffering_paused?Math.max(0,now.getTime()-new Date(r.updated_at).getTime())/1000:0));
    if(data.positionSeconds!==undefined)pos=Math.min(r.duration_seconds,data.positionSeconds);
    if(p){pos=0;await sql`UPDATE synced_participants SET playback_id=NULL,buffering=TRUE WHERE room_id=${id} AND user_id<>${userId} AND joined`;await sql`UPDATE synced_participants SET playback_id=${p.id} WHERE room_id=${id} AND user_id=${userId}`;}
    await sql`UPDATE synced_rooms SET position_seconds=${pos},paused=${data.action==='pause'?true:data.action==='play'||p?false:r.paused},buffering_policy=${data.policy||r.buffering_policy},
      queue=${p&&p.media_type==='audio'?queue:r.queue}::jsonb,queue_index=${p?data.queueIndex??r.queue_index:r.queue_index},media_id=${p?.media_id||r.media_id},edition=${p?p.edition||'':r.edition},duration_seconds=${p?.duration_seconds||r.duration_seconds},updated_at=${now},revision=revision+1,ended_at=${data.action==='end'?now:null} WHERE id=${id}`;
  });return roomState(userId,id);
}
export async function leaveRoom(userId:string,id:string){
  const r=await authorized(userId,id);
  await getSql()`UPDATE synced_participants SET joined=FALSE,buffering=FALSE,playback_id=NULL WHERE room_id=${id} AND user_id=${userId}`;
  if(r.host_id===userId)await getSql()`UPDATE synced_rooms SET ended_at=NOW(),revision=revision+1 WHERE id=${id}`;
  return {left:true};
}
