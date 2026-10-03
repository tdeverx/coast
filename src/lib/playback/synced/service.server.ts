import * as v from 'valibot';
import {getSql} from '$lib/server/db';
import {getConfig} from '$lib/server/config';
import {requireExperimentalFeatures} from '$lib/server/experimental';
import {AppError} from '$lib/server/security/errors';
import {requireFriend} from '$lib/social/service.server';
import {notify} from '$lib/server/notifications';
import {compatibleSource} from './model';
import type {RoomState,PartySettings} from './model';
const uuid=v.pipe(v.string(),v.uuid());
const position=v.pipe(v.number(),v.minValue(0),v.maxValue(604800));
const settingsSchema=v.object({playback:v.picklist(['host','everyone','selected']),controllers:v.pipe(v.array(uuid),v.maxLength(16)),invitations:v.picklist(['host','everyone']),acceptInvites:v.boolean(),readyCheck:v.boolean(),hostDisconnect:v.picklist(['wait','continue','transfer']),queue:v.picklist(['host','everyone'])});
type PartyPermissions={host_id:string;settings:PartySettings};
function controls(r:PartyPermissions,userId:string,p:{joined:boolean}|undefined){return r.host_id===userId||p?.joined&&(r.settings.playback==='everyone'||r.settings.playback==='selected'&&r.settings.controllers.includes(userId));}
function permitted(r:PartyPermissions,userId:string,joined:boolean,action:string){
 return r.host_id===userId||joined&&!['policy','end','kick','promote','settings'].includes(action)&&(action==='ready'||(action==='queue'?r.settings.queue==='everyone':controls(r,userId,{joined})));
}
async function validOwner(sql:ReturnType<typeof getSql>,id:string,userId:string){
 const [unconnected]=await sql`SELECT 1 FROM synced_participants p WHERE p.room_id=${id} AND p.user_id<>${userId} AND NOT EXISTS(SELECT 1 FROM friendships f WHERE f.user_a=least(p.user_id,${userId}::uuid) AND f.user_b=greatest(p.user_id,${userId}::uuid) AND f.state='accepted') LIMIT 1`;
 return !unconnected;
}
async function enabled(){requireExperimentalFeatures(await getConfig());}
async function authorized(userId:string,id:string){
  await enabled();
  const [room]=await getSql()`SELECT r.*,p.joined AS viewer_joined FROM synced_rooms r JOIN synced_participants p ON p.room_id=r.id
    JOIN users h ON h.id=r.host_id JOIN users viewer ON viewer.id=p.user_id WHERE r.id=${v.parse(uuid,id)} AND p.user_id=${userId} AND NOT h.disabled AND NOT viewer.disabled`;
  if(!room)throw new AppError(404,'Synced session not found.');
  if(room.host_id!==userId)await requireFriend(userId,room.host_id);
  return room;
}
async function playback(userId:string,id:string){
  const [p]=await getSql()`SELECT p.* FROM playback_sessions p JOIN provider_connections c ON c.id=p.connection_id JOIN provider_instances i ON i.id=c.instance_id
    WHERE p.share_id IS NULL AND p.id=${v.parse(uuid,id)} AND p.user_id=${userId} AND p.expires_at>NOW() AND p.state<>'stopped' AND c.status='connected' AND i.enabled`;
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
  const data=v.parse(v.object({playbackId:v.optional(uuid),positionSeconds:v.optional(position,0),paused:v.optional(v.boolean(),true),queue:v.optional(v.pipe(v.array(uuid),v.maxLength(200)),[]),queueIndex:v.optional(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(199)),0)}),input);
  const p=data.playbackId?await playback(userId,data.playbackId):null;
  if(p&&!(p.duration_seconds>0))throw new AppError(409,'This source has no duration and cannot be synchronized.');
  const queue=p?.media_type==='audio'?data.queue:[];
  if(queue.length && queue[data.queueIndex]!==p?.media_id)throw new AppError(400,'The current track must belong to the shared queue.');
  if(queue.length){const [invalid]=await getSql()`SELECT count(*)::int AS count FROM unnest(${getSql().array(queue,'TEXT')}::uuid[]) q(id) LEFT JOIN works w ON w.id=q.id WHERE w.kind IS DISTINCT FROM 'track'`;if(invalid.count)throw new AppError(400,'Choose music tracks for the shared queue.');}
  const id=crypto.randomUUID();
  await getSql().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`synced-user:${userId}`},0))`;
    await leaveOthers(sql,userId,id);
    await sql`INSERT INTO synced_rooms (id,host_id,media_id,media_type,edition,duration_seconds,position_seconds,paused,queue,queue_index)
      VALUES (${id},${userId},${p?.media_id??null},${p?.media_type??'video'},${p?.edition||''},${p?.duration_seconds??0},${Math.min(data.positionSeconds,p?.duration_seconds??0)},${p?data.paused:true},${queue}::jsonb,${data.queueIndex})`;
    await sql`INSERT INTO synced_participants (room_id,user_id,playback_id,joined,heartbeat_at) VALUES (${id},${userId},${p?.id??null},TRUE,NOW())`;
  });
  return roomState(userId,id);
}
export async function inviteParticipant(userId:string,id:string,input:unknown){
  const room=await authorized(userId,id);
  if(room.ended_at)throw new AppError(409,'This session has ended.');
  const {friendId}=v.parse(v.object({friendId:uuid}),input);await requireFriend(userId,friendId);
  await getSql().begin(async sql=>{
    const [r]=await sql`SELECT * FROM synced_rooms WHERE id=${id} AND ended_at IS NULL AND created_at>NOW()-INTERVAL '24 hours' FOR UPDATE`;
    if(!r)throw new AppError(409,'This session has ended.');
    const [member]=await sql`SELECT joined FROM synced_participants WHERE room_id=${id} AND user_id=${userId}`;
    if(!r.settings.acceptInvites)throw new AppError(409,'Invitations are closed for this party.');
    if(r.host_id!==userId&&(!member?.joined||r.settings.invitations!=='everyone'))throw new AppError(403,'Only the host can invite friends to this party.');
    if(r.host_id!==userId)await requireFriend(r.host_id,friendId);
    const [count]=await sql`SELECT count(*)::int AS total FROM synced_participants WHERE room_id=${id}`;
    if(count.total>=16)throw new AppError(409,'This session already has 16 participants.');
    await sql`INSERT INTO synced_participants (room_id,user_id) VALUES (${id},${friendId}) ON CONFLICT DO NOTHING`;
    await sql`DELETE FROM notifications WHERE user_id=${friendId} AND source_key=${`synced:${id}`}`;
    await notify({userId:friendId,kind:'synced-invite',title:'Join a party',sourceKey:`synced:${id}`,data:{actorId:userId,subjectId:id,workId:room.media_id,destination:`/synced/${id}`}},sql);
  });return {invited:true};
}
export async function joinRoom(userId:string,id:string,input:unknown){
  const room=await authorized(userId,id);
  const {playbackId,revision}=v.parse(v.object({playbackId:v.optional(uuid),revision:v.pipe(v.number(),v.integer())}),input);
  const p=playbackId?await playback(userId,playbackId):null;
  if(room.media_id&&(!p||!compatibleSource(descriptor(room),descriptor(p))))throw new AppError(409,'Your source has a different edition or duration. Choose a matching version to join.');
  await getSql().begin(async sql=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`synced-user:${userId}`},0))`;
    const [r]=await sql`SELECT revision,settings,host_id FROM synced_rooms WHERE id=${id} AND ended_at IS NULL AND created_at>NOW()-INTERVAL '24 hours' FOR UPDATE`;
    if(!r||r.revision!==revision)throw new AppError(409,'The session changed while preparing. Refresh and try again.');
    const [member]=await sql`SELECT joined FROM synced_participants WHERE room_id=${id} AND user_id=${userId}`;
    if(r.host_id!==userId&&!member?.joined&&!r.settings.acceptInvites)throw new AppError(409,'This party is closed to new members.');
    await leaveOthers(sql,userId,id);
    await sql`UPDATE synced_participants SET playback_id=${p?.id??null},joined=TRUE,buffering=FALSE,unavailable=FALSE,heartbeat_at=NOW() WHERE room_id=${id} AND user_id=${userId}`;
  });return roomState(userId,id);
}
export async function roomState(userId:string,id:string,input?:unknown):Promise<RoomState>{
  await authorized(userId,id);
  const heartbeat=input===undefined?null:v.parse(v.object({buffering:v.boolean(),unavailable:v.optional(v.boolean(),false)}),input);
  return getSql().begin(async sql=>{
    const [r]=await sql`SELECT * FROM synced_rooms WHERE id=${id} FOR UPDATE`;
    if(heartbeat)await sql`UPDATE synced_participants SET heartbeat_at=NOW(),buffering=${heartbeat.buffering},unavailable=${heartbeat.unavailable} WHERE room_id=${id} AND user_id=${userId} AND joined`;
    // Friendship removal and disabled accounts revoke session participation too.
    await sql`UPDATE synced_participants p SET joined=FALSE,buffering=FALSE WHERE p.room_id=${id} AND p.user_id<>${r.host_id} AND (EXISTS(SELECT 1 FROM users u WHERE u.id=p.user_id AND u.disabled) OR NOT EXISTS(SELECT 1 FROM friendships f WHERE f.user_a=least(p.user_id,${r.host_id}::uuid) AND f.user_b=greatest(p.user_id,${r.host_id}::uuid) AND f.state='accepted'))`;
    await sql`UPDATE synced_participants p SET joined=FALSE,buffering=FALSE WHERE p.room_id=${id} AND p.playback_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM playback_sessions b JOIN provider_connections c ON c.id=b.connection_id JOIN provider_instances i ON i.id=c.instance_id
      WHERE b.id=p.playback_id AND b.user_id=p.user_id AND b.expires_at>NOW() AND c.status='connected' AND i.enabled)`;
    const members:RoomState['participants']=await sql`SELECT p.user_id AS "userId",u.username,CASE WHEN social_visible(u.id,${userId}::uuid,'details') THEN u.settings->'profile'->>'avatar' END AS avatar,p.joined,p.buffering,p.ready,p.unavailable,(p.heartbeat_at>NOW()-INTERVAL '15 seconds') AS online FROM synced_participants p JOIN users u ON u.id=p.user_id WHERE p.room_id=${id} ORDER BY (p.user_id=${r.host_id}) DESC,u.username,p.user_id`;
    const controllers=r.settings.controllers.filter((user:string)=>members.some(member=>member.userId===user&&member.joined));
    if(controllers.length!==r.settings.controllers.length){
      r.settings={...r.settings,controllers};r.revision++;
      await sql`UPDATE synced_rooms SET settings=${r.settings}::jsonb,revision=${r.revision} WHERE id=${id}`;
    }
    const queueItems= r.media_type==='audio' ? await sql`SELECT q.id,coalesce(m.title,'Unknown track') AS title,CASE WHEN EXISTS(SELECT 1 FROM availability a JOIN provider_connections c ON c.id=a.connection_id JOIN provider_instances i ON i.id=c.instance_id WHERE a.media_id=q.id AND a.user_id=${userId} AND a.state='available' AND c.status='connected' AND i.enabled) THEN 'available' ELSE 'unknown' END AS availability
      FROM unnest(${sql.array(r.queue,'TEXT')}::uuid[]) WITH ORDINALITY q(id,ordinal) LEFT JOIN music_works m ON m.id=q.id ORDER BY q.ordinal` : [];
    let hostOnline=members.some(p=>p.userId===r.host_id&&p.joined&&p.online);
    if(!hostOnline&&r.settings.hostDisconnect==='transfer'){
      for(const member of members.filter(p=>p.joined&&p.online&&!p.unavailable&&!p.buffering&&p.userId!==r.host_id)){
        if(await validOwner(sql,id,member.userId)){await sql`UPDATE synced_rooms SET host_id=${member.userId},revision=revision+1 WHERE id=${id}`;r.host_id=member.userId;r.revision++;hostOnline=true;break;}
      }
    }
    let grace=false;
    if(!hostOnline&&r.settings.hostDisconnect==='continue'){
      const [host]=await sql`SELECT heartbeat_at FROM synced_participants WHERE room_id=${id} AND user_id=${r.host_id}`;
      grace=!!host?.heartbeat_at&&Date.now()-new Date(host.heartbeat_at).getTime()<60000;
    }
    const blocked=(!hostOnline&&!grace)||(r.settings.readyCheck&&members.some(p=>p.joined&&!p.ready))||(r.buffering_policy==='together'&&members.some(p=>p.joined&&p.online&&(p.buffering||p.unavailable)));
    if(!r.ended_at&&(blocked!==r.buffering_paused||new Date(r.created_at).getTime()<Date.now()-86400000)){
      const now=new Date();
      const pos=Math.min(r.duration_seconds,r.position_seconds+(!r.paused&&!r.buffering_paused?Math.max(0,now.getTime()-new Date(r.updated_at).getTime())/1000:0));
      const expired=new Date(r.created_at).getTime()<Date.now()-86400000;
      await sql`UPDATE synced_rooms SET position_seconds=${pos},buffering_paused=${blocked},updated_at=${now},revision=revision+1,ended_at=${expired?now:null} WHERE id=${id}`;
      Object.assign(r,{position_seconds:pos,buffering_paused:blocked,updated_at:now,revision:r.revision+1,ended_at:expired?now:null});
    }
    return {id:r.id,createdAt:new Date(r.created_at).toISOString(),hostId:r.host_id,mediaId:r.media_id,mediaType:r.media_type,edition:r.edition,durationSeconds:r.duration_seconds,positionSeconds:r.position_seconds,paused:r.paused,bufferingPaused:r.buffering_paused,bufferingPolicy:r.buffering_policy,settings:r.settings,queue:r.queue,queueIndex:r.queue_index,queueItems,revision:r.revision,updatedAt:new Date(r.updated_at).toISOString(),serverTime:new Date().toISOString(),ended:!!r.ended_at,participants:members.map(p=>({...p,online:!!p.online}))} as RoomState;
  });
}
export async function commandRoom(userId:string,id:string,input:unknown){
  const room=await authorized(userId,id);
  const data=v.parse(v.object({revision:v.pipe(v.number(),v.integer()),action:v.picklist(['play','pause','seek','policy','item','stop','end','kick','promote','settings','ready','queue']),userId:v.optional(uuid),ready:v.optional(v.boolean()),settings:v.optional(settingsSchema),positionSeconds:v.optional(position),policy:v.optional(v.picklist(['together','catch-up'])),playbackId:v.optional(uuid),queueIndex:v.optional(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(199))),queue:v.optional(v.pipe(v.array(uuid),v.maxLength(200)))}),input);
  if(!permitted(room,userId,room.viewer_joined,data.action))throw new AppError(403,'Playback is controlled by the host.');
  const p=data.action==='item'&&data.playbackId?await playback(userId,data.playbackId):null;
  if(data.action==='item'&&!p)throw new AppError(400,'Prepare the next item first.');
  if(!room.media_id&&['play','pause','seek'].includes(data.action))throw new AppError(409,'Choose something to play first.');
  const queue=data.queue??(room.media_type==='audio'?room.queue:[]);
  if(p&&(!(p.duration_seconds>0)||p.media_type==='audio'&&queue.length>0&&queue[data.queueIndex??room.queue_index]!==p.media_id))throw new AppError(409,'Choose a compatible item in this shared queue.');
  if(p&&p.media_type==='audio'&&data.queue){const [invalid]=await getSql()`SELECT count(*)::int AS count FROM unnest(${getSql().array(queue,'TEXT')}::uuid[]) q(id) LEFT JOIN works w ON w.id=q.id WHERE w.kind IS DISTINCT FROM 'track'`;if(invalid.count)throw new AppError(400,'Choose music tracks for the shared queue.');}
  await getSql().begin(async sql=>{
    const [r]=await sql`SELECT * FROM synced_rooms WHERE id=${id} FOR UPDATE`;
    const [actor]=await sql`SELECT joined FROM synced_participants WHERE room_id=${id} AND user_id=${userId}`;
    if(!permitted(r,userId,actor?.joined??false,data.action))throw new AppError(403,'Playback is controlled by the host.');
    if(r.ended_at||r.revision!==data.revision)throw new AppError(409,'The session changed. Refresh before changing playback.');
    if(data.policy!==undefined&&data.action!=='policy'||data.positionSeconds!==undefined&&data.action!=='seek')throw new AppError(400,'Use the matching playback action.');
    if(data.action==='policy'&&!data.policy)throw new AppError(400,'Choose a buffering policy.');
    if(data.action==='seek'&&data.positionSeconds===undefined)throw new AppError(400,'Choose a playback position.');
    if(p?.media_type==='audio'&&data.queue&&r.host_id!==userId&&r.settings.queue!=='everyone'&&JSON.stringify(data.queue)!==JSON.stringify(r.queue))throw new AppError(403,'Only the host can change this queue.');
    if(data.action==='ready'){
      if(data.ready===undefined)throw new AppError(400,'Choose your ready state.');
      await sql`UPDATE synced_participants SET ready=${data.ready} WHERE room_id=${id} AND user_id=${userId} AND joined`;
      await sql`UPDATE synced_rooms SET revision=revision+1 WHERE id=${id}`;return;
    }
    if(data.action==='settings'){
      if(!data.settings)throw new AppError(400,'Choose party settings.');
      const [invalid]=await sql`SELECT 1 FROM unnest(${sql.array(data.settings.controllers,'TEXT')}::uuid[]) c(id) WHERE NOT EXISTS(SELECT 1 FROM synced_participants p WHERE p.room_id=${id} AND p.user_id=c.id AND p.joined) LIMIT 1`;
      if(invalid)throw new AppError(400,'Controllers must be joined participants.');
      await sql`UPDATE synced_rooms SET settings=${data.settings}::jsonb,revision=revision+1 WHERE id=${id}`;return;
    }
    if(data.action==='queue'){
      if(r.media_type!=='audio'||!data.queue||data.queueIndex===undefined||data.queue[data.queueIndex]!==r.media_id)throw new AppError(400,'Keep the playing track in the music queue.');
      const [invalid]=await sql`SELECT 1 FROM unnest(${sql.array(data.queue,'TEXT')}::uuid[]) q(id) LEFT JOIN works w ON w.id=q.id WHERE w.kind IS DISTINCT FROM 'track' LIMIT 1`;
      if(invalid)throw new AppError(400,'Choose music tracks for the shared queue.');
      await sql`UPDATE synced_rooms SET queue=${data.queue}::jsonb,queue_index=${data.queueIndex},revision=revision+1 WHERE id=${id}`;return;
    }
    if(data.action==='kick'||data.action==='promote'){
      if(!data.userId||data.userId===r.host_id)throw new AppError(400,'Choose another party participant.');
      const [target]=await sql`SELECT p.joined,u.disabled FROM synced_participants p JOIN users u ON u.id=p.user_id WHERE p.room_id=${id} AND p.user_id=${data.userId} FOR UPDATE OF p`;
      if(!target)throw new AppError(404,'Participant not found.');
      if(data.action==='kick'){
        await sql`DELETE FROM synced_participants WHERE room_id=${id} AND user_id=${data.userId}`;
        await sql`UPDATE synced_rooms SET settings=jsonb_set(settings,'{controllers}',${r.settings.controllers.filter((user:string)=>user!==data.userId)}::jsonb) WHERE id=${id}`;
      }
      else {
        if(!target.joined||target.disabled)throw new AppError(409,'The new owner must have joined the party.');
        if(!await validOwner(sql,id,data.userId))throw new AppError(409,'The new owner must be friends with everyone invited to this party.');
        await sql`UPDATE synced_rooms SET host_id=${data.userId} WHERE id=${id}`;
      }
      await sql`UPDATE synced_rooms SET revision=revision+1 WHERE id=${id}`;
      return;
    }
    const now=new Date();let pos=Math.min(r.duration_seconds,r.position_seconds+(!r.paused&&!r.buffering_paused?Math.max(0,now.getTime()-new Date(r.updated_at).getTime())/1000:0));
    if(data.positionSeconds!==undefined)pos=Math.min(r.duration_seconds,data.positionSeconds);
    if(data.action==='stop'){pos=0;await sql`UPDATE synced_participants SET playback_id=NULL,buffering=FALSE WHERE room_id=${id}`;}
    if(p){pos=0;await sql`UPDATE synced_participants SET ready=FALSE,unavailable=FALSE WHERE room_id=${id}`;await sql`UPDATE synced_participants SET playback_id=NULL,buffering=TRUE WHERE room_id=${id} AND user_id<>${userId} AND joined`;await sql`UPDATE synced_participants SET playback_id=${p.id} WHERE room_id=${id} AND user_id=${userId}`;}
    await sql`UPDATE synced_rooms SET position_seconds=${pos},paused=${data.action==='pause'||data.action==='stop'?true:data.action==='play'||p?false:r.paused},buffering_policy=${data.policy||r.buffering_policy},
      media_type=${p?.media_type??r.media_type},queue=${p?(p.media_type==='audio'?queue:[]):r.queue}::jsonb,queue_index=${p?data.queueIndex??r.queue_index:r.queue_index},media_id=${data.action==='stop'?null:p?.media_id||r.media_id},edition=${p?p.edition||'':r.edition},duration_seconds=${p?.duration_seconds||r.duration_seconds},updated_at=${now},revision=revision+1,ended_at=${data.action==='end'?now:null} WHERE id=${id}`;
  });return roomState(userId,id);
}
export async function leaveRoom(userId:string,id:string){
  const r=await authorized(userId,id);
  await getSql()`UPDATE synced_participants SET joined=FALSE,buffering=FALSE,playback_id=NULL WHERE room_id=${id} AND user_id=${userId}`;
  if(r.host_id===userId)await getSql()`UPDATE synced_rooms SET ended_at=NOW(),revision=revision+1 WHERE id=${id}`;
  return {left:true};
}

export async function declineInvitation(userId:string,id:string){
  const room=await authorized(userId,id);
  if(room.host_id===userId)throw new AppError(409,'The host cannot decline their own session.');
  await getSql().begin(async sql=>{
    const [participant]=await sql`SELECT joined FROM synced_participants WHERE room_id=${id} AND user_id=${userId} FOR UPDATE`;
    if(participant?.joined)throw new AppError(409,'Leave the session before declining an invitation.');
    await sql`DELETE FROM synced_participants WHERE room_id=${id} AND user_id=${userId}`;
    await sql`UPDATE notifications SET dismissed_at=NOW(),read_at=coalesce(read_at,NOW()) WHERE user_id=${userId} AND kind='synced-invite' AND data->>'subjectId'=${id}`;
  });
  return {declined:true};
}

export async function listRooms(userId:string):Promise<{id:string;createdAt:string;host:string;hostId:string;mediaId:string|null;mediaType:'audio'|'video';joined:boolean;progress:number|null;durationSeconds:number;positionSeconds:number;paused:boolean;bufferingPaused:boolean;updatedAt:string;participants:{userId:string;username:string;avatar:string|null;joined:boolean}[]}[]>{
  await enabled();
  const rows=await getSql()`SELECT r.id,r.created_at AS "createdAt",u.username AS host,r.host_id AS "hostId",r.media_id AS "mediaId",r.media_type AS "mediaType",p.joined,r.duration_seconds AS "durationSeconds",r.position_seconds AS "positionSeconds",r.paused,r.buffering_paused AS "bufferingPaused",r.updated_at AS "updatedAt",
    CASE WHEN r.media_id IS NOT NULL AND r.duration_seconds>0 THEN least(1.0,greatest(0.0,(r.position_seconds+CASE WHEN NOT r.paused AND NOT r.buffering_paused THEN greatest(0,extract(epoch from now()-r.updated_at)) ELSE 0 END)/r.duration_seconds)) END::real AS progress,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('userId',member.id,'username',member.username,'joined',participant.joined,'avatar',CASE WHEN social_visible(member.id,${userId}::uuid,'details') THEN member.settings->'profile'->>'avatar' END) ORDER BY (member.id=r.host_id) DESC,member.username),'[]'::jsonb)
     FROM synced_participants participant JOIN users member ON member.id=participant.user_id
     WHERE participant.room_id=r.id AND NOT member.disabled AND
     (member.id=r.host_id OR EXISTS(SELECT 1 FROM friendships f WHERE f.user_a=least(member.id,r.host_id) AND f.user_b=greatest(member.id,r.host_id) AND f.state='accepted'))) AS participants FROM synced_rooms r
    JOIN synced_participants p ON p.room_id=r.id JOIN users u ON u.id=r.host_id
    WHERE p.user_id=${userId} AND NOT u.disabled AND r.ended_at IS NULL
    AND r.created_at>NOW()-INTERVAL '24 hours'
    AND (r.host_id=${userId} OR EXISTS(SELECT 1 FROM friendships f WHERE f.user_a=least(r.host_id,${userId}::uuid) AND f.user_b=greatest(r.host_id,${userId}::uuid) AND f.state='accepted'))
    ORDER BY r.updated_at DESC LIMIT 60`;
  return rows;
}
