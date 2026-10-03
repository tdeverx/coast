import * as v from 'valibot';
import {and,eq,sql} from 'drizzle-orm';
import {collectionCTE,collectionRead} from '$lib/collection/query.server';
import {getSql,getDb} from '$lib/server/db';
import {socialRecommendations,friendships,notifications} from '$lib/server/db/schema';
import {trackInTransaction} from '$lib/core/tracking/service';
import {enqueueTraktChangeInTransaction,enqueueCollectionProjectionInTransaction} from '$lib/sync/changes';
import {notify,resolveNotification} from '$lib/server/notifications';
import {AppError} from '$lib/server/security/errors';
import {emojis} from './model';
import {friendStatusSql} from './status.server';
const uuid=v.pipe(v.string(),v.uuid());
export async function incomingFriendRequests(userId:string){
 const [row]=await getSql()`select count(*)::int as count from friendships f join users u on u.id=f.requested_by where f.state='pending' and f.requested_by<>${userId}::uuid and (${userId}::uuid=f.user_a or ${userId}::uuid=f.user_b) and not u.disabled`;
 return Number(row.count);
}
export async function friends(userId:string,page=1,state:'all'|'accepted'|'pending'='all',userIds?:string[]):Promise<import('./model').FriendEntry[]> {
 return await getSql()`select f.id,f.state,f.requested_by as "requestedBy",f.created_at as "createdAt",u.id as "userId",u.username,
 case when social_visible(u.id,${userId}::uuid,'details') then u.settings->'profile'->>'avatar' end as avatar, social_visible(u.id,${userId}::uuid,'insights') as "canCompare", ${friendStatusSql(userId)} as "activityStatus",
 case when social_visible(u.id,${userId}::uuid,'details') then case when coalesce(u.settings->'profile'->>'backgroundMode',case when u.settings->'profile'->>'backgroundMediaId' is not null then 'fixed' else 'activity' end)='activity' then
 (select a.work_id::text from social_activity a join works w on w.id=a.work_id where a.user_id=u.id and a.date_known and a.event_kind in ('watch','listen','play','played','session') and a.occurred_at<=now() and social_visible(u.id,${userId}::uuid,a.section,w.category) and (w.category='screen' or coalesce((select value->>'experimentalFeatures' from system_settings where key='coast'),'false')='true') order by a.occurred_at desc,a.id desc limit 1)
 else u.settings->'profile'->>'backgroundMediaId' end end as "backgroundWorkId"
 from friendships f join users u on u.id=case when f.user_a=${userId}::uuid then f.user_b else f.user_a end left join user_presence up on up.user_id=u.id
 where (f.user_a=${userId}::uuid or f.user_b=${userId}::uuid) and not u.disabled and f.state in ('pending','accepted') and (${state}='all' or f.state=${state}) and (${userIds===undefined} or u.id=any(${getSql().array(userIds??[],'TEXT')}::uuid[])) order by f.state desc,u.username,f.id limit 61 offset ${(page-1)*60}`;
}
export async function requestFriend(userId:string,raw:unknown) {
 const input=v.parse(v.object({username:v.pipe(v.string(),v.trim(),v.minLength(1),v.maxLength(100))}),raw);
 return getSql().begin(async db=>{
  const [other]=await db`select id,username from users where lower(username)=lower(${input.username}) and not disabled`;
  if(!other)throw new AppError(404,'Username not found.');
  if(other.id===userId)throw new AppError(400,'Choose another user.');
  const [a,b]=[userId,String(other.id)].sort();
  await db`select pg_advisory_xact_lock(hashtextextended(${a+':'+b},0))`;
  const [existing]=await db`select * from friendships where user_a=${a} and user_b=${b} for update`;
  if(existing&&['pending','accepted'].includes(existing.state))return {id:existing.id,state:existing.state};
  const [row]=await db`insert into friendships(user_a,user_b,requested_by) values(${a},${b},${userId}) on conflict(user_a,user_b) do update set requested_by=excluded.requested_by,state='pending',created_at=now(),updated_at=now() returning id,state`;
  return row;
 });
}
export async function changeFriend(userId:string,id:string,raw:unknown) {
 const {action}=v.parse(v.object({action:v.picklist(['accept','decline','cancel','remove'])}),raw);
 return getSql().begin(async db=>{
  const [f]=await db`select * from friendships where id=${id} and (${userId}::uuid=user_a or ${userId}::uuid=user_b) for update`;
  if(!f)throw new AppError(404,'Friend request not found.');
  const target=action==='accept'?'accepted':action==='decline'?'declined':action==='cancel'?'cancelled':'removed';
  if(f.state===target)return {state:target};
  if(action==='remove'?f.state!=='accepted':f.state!=='pending'||(action==='cancel'?f.requested_by!==userId:f.requested_by===userId))throw new AppError(409,'This action is no longer available.');
  await db`update friendships set state=${target},updated_at=now() where id=${id}`;
  const recipient=f.requested_by===f.user_a?f.user_b:f.user_a;
  await resolveNotification(recipient,'friend-request:'+id,db);
  if(action==='accept')await notify({userId:f.requested_by,kind:'friend-accepted',title:'Friend request accepted',sourceKey:'friend-accepted:'+id,data:{actorId:userId,subjectId:id,destination:'/for-you?friends=true'}},db);
  return {state:target};
 });
}
export async function requireFriend(userId:string,otherId:string) {
 const [f]=await getSql()`select f.id from friendships f join users u on u.id=${otherId}::uuid where f.user_a=least(${userId}::uuid,${otherId}::uuid) and f.user_b=greatest(${userId}::uuid,${otherId}::uuid) and f.state='accepted' and not u.disabled`;
 if(!f)throw new AppError(403,'This action is available between friends.');
}
export async function react(userId:string,raw:unknown) {
 const input=v.parse(v.object({targetKind:v.picklist(['work','activity']),targetId:uuid,emoji:v.nullable(v.picklist(emojis))}),raw);
 return getSql().begin(async db=>{
  let owner:string|undefined,workId:string;
  if(input.targetKind==='activity') {
   const [event]=await db`select a.*,w.category from social_activity a join works w on w.id=a.work_id where a.id=${input.targetId} and social_visible(a.user_id,${userId}::uuid,a.section,w.category)`;
   if(!event)throw new AppError(404,'Activity not found.');owner=event.user_id;workId=event.work_id;
  }else{
   const [work]=await db`select id,category from works where id=${input.targetId}`;
   if(!work)throw new AppError(404,'Media not found.');workId=work.id;
  }
  if(input.emoji===null)await db`delete from social_reactions where user_id=${userId} and target_kind=${input.targetKind} and target_id=${input.targetId}`;
  else await db`insert into social_reactions(user_id,target_kind,target_id,emoji) values(${userId},${input.targetKind},${input.targetId},${input.emoji}) on conflict(user_id,target_kind,target_id) do update set emoji=excluded.emoji,updated_at=now()`;
  if(owner&&owner!==userId) {
   const key=`reaction:${userId}:${input.targetId}`;
   if(input.emoji===null)await resolveNotification(owner,key,db);
   else if((await db`select social_visible(${userId}::uuid,${owner}::uuid,'reactions',(select category from works where id=${workId})) as allowed`)[0].allowed)
    await notify({userId:owner,kind:'reaction',title:`Reacted ${input.emoji} to your activity`,sourceKey:key,data:{actorId:userId,subjectId:input.targetId,workId,destination:'/for-you?section=activity'}},db);
  }
  return {emoji:input.emoji};
 });
}
export async function recommendations(userId:string,page=1,availableOnly=false) {
 const rows=await collectionRead(sql`${collectionCTE(userId,userId)}
 select r.id,r.state,r.sender_id as "senderId",r.recipient_id as "recipientId",r.work_id as "workId",r.created_at as "createdAt",u.username
 from social_recommendations r join users u on u.id=case when r.sender_id=${userId} then r.recipient_id else r.sender_id end
 where (r.recipient_id=${userId} or r.sender_id=${userId}) and not u.disabled
 and exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(r.sender_id,r.recipient_id) and f.user_b=greatest(r.sender_id,r.recipient_id))
 and (${!availableOnly} or exists(select 1 from assessments a where a.id=r.work_id and a.availability in ('available','partial')))
 order by r.created_at desc,r.id desc limit 61 offset ${(page-1)*60}`);
 return Array.from(rows).map(r=>({id:String(r.id),state:String(r.state),senderId:String(r.senderId),recipientId:String(r.recipientId),workId:String(r.workId),createdAt:new Date(r.createdAt),username:String(r.username)}));
}
export async function recommend(userId:string,raw:unknown) {
 const input=v.parse(v.object({recipientId:uuid,workId:uuid}),raw);
 await requireFriend(userId,input.recipientId);
 return getSql().begin(async db=>{
  // Lock friendship with delivery so removal cannot race a recommendation.
  const [f]=await db`select id from friendships where state='accepted' and user_a=least(${userId}::uuid,${input.recipientId}::uuid) and user_b=greatest(${userId}::uuid,${input.recipientId}::uuid) for update`;
  if(!f)throw new AppError(403,'This action is available between friends.');
  const [work]=await db`select id from works where id=${input.workId}`;if(!work)throw new AppError(404,'Media not found.');
  const [r]=await db`insert into social_recommendations(sender_id,recipient_id,work_id) values(${userId},${input.recipientId},${input.workId}) on conflict(sender_id,recipient_id,work_id) where state='pending' do update set work_id=excluded.work_id returning id,state`;
  await notify({userId:input.recipientId,kind:'recommendation',title:'A friend recommended something',sourceKey:'recommendation:'+r.id,data:{actorId:userId,subjectId:r.id,workId:input.workId,destination:'/for-you?notifications=true&notificationKind=recommendation',actions:['save','dismiss']}},db);
  return r;
 });
}
export async function respondRecommendation(userId:string,id:string,raw:unknown) {
 const {action}=v.parse(v.object({action:v.picklist(['save','dismiss'])}),raw);
 return getDb().transaction(async tx=>{
  const [r]=await tx.select().from(socialRecommendations).where(and(eq(socialRecommendations.id,id),eq(socialRecommendations.recipientId,userId))).for('update');
  if(!r)throw new AppError(404,'Recommendation not found.');
  const [f]=await tx.select().from(friendships).where(and(eq(friendships.userA,[userId,r.senderId].sort()[0]),eq(friendships.userB,[userId,r.senderId].sort()[1]),eq(friendships.state,'accepted'))).for('update');
  if(!f)throw new AppError(403,'This recommendation is no longer available.');
  if(r.state!=='pending')return {state:r.state};
  if(action==='save'){
   const result=await trackInTransaction(tx,userId,{mediaId:r.workId,action:'watchlist',value:true});
   if(result.changed&&!result.reviewRequired){
    await enqueueTraktChangeInTransaction(tx,userId,{mediaId:r.workId,category:'watchlist',eventId:result.eventId??undefined});
    await enqueueCollectionProjectionInTransaction(tx,userId);
   }
  }
  await tx.update(socialRecommendations).set({state:action==='save'?'saved':'dismissed',updatedAt:new Date()}).where(eq(socialRecommendations.id,id));
  await tx.delete(notifications).where(and(eq(notifications.userId,userId),eq(notifications.sourceKey,'recommendation:'+id)));
  return {state:action==='save'?'saved':'dismissed'};
 });
}
