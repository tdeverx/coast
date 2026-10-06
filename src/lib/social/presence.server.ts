import * as v from 'valibot';
import {and,eq,sql} from 'drizzle-orm';
import {getDb,getSql} from '$lib/server/db';
import {socialCheckins,socialLiveDeliveries,users,providerConnections,providerInstances} from '$lib/server/db/schema';
import {AppError} from '$lib/server/security/errors';
import {trackInTransaction} from '$lib/core/tracking/service';
import {enqueueInTransaction,enqueueTraktChangeInTransaction} from '$lib/sync/changes';
export async function presence(userId:string) {
 return getSql()`with candidates as (
 select user_id,media_id as work_id,'playback' as source,updated_at as observed_at,expires_at,0 as priority,position_seconds,duration_seconds from playback_sessions where share_id is null and state='active' and expires_at>now() and updated_at>now()-interval '2 minutes'
 union all select user_id,work_id,'checkin',created_at,expires_at,1,null,null from social_checkins where state='active' and expires_at>now()
 union all select c.user_id,s.work_id,i.provider,s.checked_at,s.expires_at,2,null,null from social_live_state s join provider_connections c on c.id=s.connection_id join provider_instances i on i.id=c.instance_id where c.status='connected' and i.enabled and s.account_generation=c.account_generation and s.work_id is not null and (s.expires_at>now() or (s.checked_at>now()-interval '30 minutes' and exists(select 1 from outbox_actions a where a.connection_id=c.id and a.account_generation=c.account_generation and a.kind=i.provider||'.live' and a.state in ('pending','running')))))
 select distinct on (p.user_id) p.user_id as "userId",u.username,p.work_id as "workId",w.category,
 case when e.media_id is not null then coalesce(show.title,m.title)||' — S'||lpad(e.season_number::text,greatest(2,length(e.season_number::text)),'0')||'E'||lpad(e.episode_number::text,greatest(2,length(e.episode_number::text)),'0') else coalesce(m.title,music.title,g.title) end as title,
 case when w.category='music' then '/music/work/'||w.id when w.category='game' then '/games/'||w.id else '/media/'||w.id end as href,p.source,p.expires_at as "expiresAt",
 case when p.duration_seconds>0 and social_visible(p.user_id,${userId}::uuid,'progress',w.category) then least(1.0,greatest(0.0,p.position_seconds/p.duration_seconds)) end::real as progress from candidates p join works w on w.id=p.work_id join users u on u.id=p.user_id left join media m on m.id=w.id left join music_works music on music.id=w.id left join games g on g.id=w.id left join episodes e on e.media_id=w.id left join media show on show.id=e.show_id
 where not u.disabled and (p.user_id=${userId}::uuid or coalesce(u.settings->>'activityStatus','automatic')<>'invisible') and (p.user_id=${userId} or exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(p.user_id,${userId}::uuid) and f.user_b=greatest(p.user_id,${userId}::uuid))) and social_visible(p.user_id,${userId}::uuid,'presence',w.category) and (w.category='screen' or (w.category='music' and coalesce((select value->>'experimentalMusic' from system_settings where key='coast'),'false')='true') or (w.category='game' and coalesce((select value->>'experimentalGaming' from system_settings where key='coast'),'false')='true'))
 order by p.user_id,p.priority,p.observed_at desc`;
}
async function queueCheckin(tx:Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],userId:string,id:string) {
 const connections=await tx.select({id:providerConnections.id}).from(providerConnections).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId)).where(and(eq(providerConnections.userId,userId),eq(providerConnections.status,'connected'),eq(providerInstances.provider,'trakt'),eq(providerInstances.enabled,true),sql`${providerConnections.settings}->'sync'->>'scrobble'='true'`));
 for(const c of connections)await enqueueInTransaction(tx,{userId,connectionId:c.id,kind:'trakt.checkin',payload:{checkinId:id},compactionKey:`checkin:${id}`});
}
export async function startCheckin(userId:string,raw:unknown) {
 const {workId}=v.parse(v.object({workId:v.pipe(v.string(),v.uuid())}),raw);
 return getDb().transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
  const [work]=await tx.execute<{runtime:number|null;kind:string}>(sql`select kind,runtime_minutes as runtime from media where id=${workId}`);
  if(!work||!['movie','episode'].includes(work.kind)||!work.runtime||work.runtime<=0)throw new AppError(400,'Check-ins need a movie or episode with a known runtime.');
  const [playing]=await tx.execute(sql`select id from playback_sessions where share_id is null and user_id=${userId} and state='active' and expires_at>now() and updated_at>now()-interval '2 minutes'`);
  if(playing)throw new AppError(409,'Stop playback before checking in.');
  const [current]=await tx.select().from(socialCheckins).where(and(eq(socialCheckins.userId,userId),eq(socialCheckins.state,'active'))).for('update');
  if(current){if(current.workId===workId)return current;throw new AppError(409,'Cancel your current check-in first.');}
  const [row]=await tx.insert(socialCheckins).values({userId,workId,expiresAt:new Date(Date.now()+work.runtime*60000)}).returning();
  await queueCheckin(tx,userId,row.id);return row;
 });
}
export async function cancelCheckin(userId:string,id:string) {
 return getDb().transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
  const [row]=await tx.select().from(socialCheckins).where(and(eq(socialCheckins.userId,userId),eq(socialCheckins.id,id))).for('update');
  if(!row)throw new AppError(404,'Check-in not found.');
  if(row.state==='active') {await tx.update(socialCheckins).set({state:'cancelled',updatedAt:new Date()}).where(eq(socialCheckins.id,id));}
  return {state:row.state==='active'?'cancelled':row.state};
 });
}
export async function completeCheckin(userId:string,id:string) {
 return getDb().transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId},0))`);
  const [row]=await tx.select().from(socialCheckins).where(and(eq(socialCheckins.id,id),eq(socialCheckins.userId,userId))).for('update');
  if(!row||row.state!=='active'||row.expiresAt.getTime()>Date.now())return;
  const [actor]=await tx.select({disabled:users.disabled}).from(users).where(eq(users.id,userId));
  if(!actor||actor.disabled){await tx.update(socialCheckins).set({state:'cancelled'}).where(eq(socialCheckins.id,id));return;}
  const result=await trackInTransaction(tx,userId,{mediaId:row.workId,action:'watch',source:'coast',sourceEventId:`checkin:${row.id}`,occurredAt:row.expiresAt.toISOString(),rewatch:true});
  // Trakt completes a delivered check-in itself; exporting it again would add a second play.
  const delivered = await tx.select({connectionId:socialLiveDeliveries.connectionId}).from(socialLiveDeliveries)
    .innerJoin(providerConnections,eq(providerConnections.id,socialLiveDeliveries.connectionId))
    .where(and(eq(socialLiveDeliveries.checkinId,row.id),eq(socialLiveDeliveries.accountGeneration,providerConnections.accountGeneration),sql`${socialLiveDeliveries.state} in ('started','uncertain')`));
  if(!result.duplicate)await enqueueTraktChangeInTransaction(tx,userId,{mediaId:row.workId,category:'history',occurredAt:row.expiresAt.toISOString(),eventId:result.eventId??undefined,excludeConnectionIds:delivered.map(d=>d.connectionId)});
  await tx.update(socialCheckins).set({state:'completed',updatedAt:new Date()}).where(eq(socialCheckins.id,id));
 });
}
