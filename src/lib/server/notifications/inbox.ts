import * as v from 'valibot';
import { getSql } from '$lib/server/db';
import { requireUser,type SessionUser } from '$lib/server/auth';
import { AppError } from '$lib/server/security/errors';
import { serviceTasks } from '$lib/providers/tasks';
import { workCards,workAssessments } from '$lib/collection/query.server';
import { activityFeed } from '$lib/social/queries.server';
import { friends } from '$lib/social/service.server';
import { statusesForUsers } from '$lib/social/status.server';
import { defaultNotificationFilters,notificationKinds,notificationDestination,type NotificationFilters,type NotificationEntry } from '$lib/notifications/model';
const uuid=v.pipe(v.string(),v.uuid());
const filterSchema=v.object({segment:v.optional(v.picklist(['all','social','requests','system']),'all'),kind:v.optional(v.picklist(notificationKinds.map(k=>k.value)),'all'),unread:v.optional(v.boolean(),false),category:v.optional(v.picklist(['all','screen','game','music']),'all'),period:v.optional(v.picklist(['all','week','month']),'all')});
export function notificationFilters(input:unknown):NotificationFilters {return v.parse(filterSchema,input);}
export function notificationParameters(url:URL){return {...Object.fromEntries(['segment','kind','category','period','before','beforeId'].flatMap(key=>url.searchParams.has(key)?[[key,url.searchParams.get(key)]]:[])),unread:url.searchParams.get('unread')==='true'};}
function visible(userId:string,filters:NotificationFilters=defaultNotificationFilters){
 return getSql()`with context as (
 select n.*,coalesce(case when n.data->>'workId'~'^[0-9a-fA-F-]{36}$' then (n.data->>'workId')::uuid end,
 room.media_id,recommendation.work_id,request.media_id,case when job.payload->>'mediaId'~'^[0-9a-fA-F-]{36}$' then (job.payload->>'mediaId')::uuid end,case when n.source_key~'^available:[0-9a-fA-F-]{36}$' then substring(n.source_key from 11)::uuid end) as work_id,
 job.kind as job_kind,provider.id as job_instance,job.connection_id as job_connection,job.payload->'_jobFailure'->>'code' as failure_code,provider.name as service_name,provider.provider as provider_kind,
 request.state as request_state,case when room.id is not null then case when room.ended_at is not null then 'Ended' when room.paused then 'Paused' else 'Playing' end end as session_state
 from notifications n left join outbox_actions job on n.kind='external-action' and job.id::text=split_part(n.source_key,':',2) and job.user_id=n.user_id
 left join provider_connections connection on connection.id=job.connection_id
 left join provider_instances provider on provider.id=connection.instance_id or (job.kind in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations') and job.kind like provider.provider||'.%' and provider.id::text=job.payload->>'instanceId')
 left join social_recommendations recommendation on n.kind='recommendation' and recommendation.id::text=n.data->>'subjectId' and recommendation.recipient_id=n.user_id
 left join synced_rooms room on n.kind='synced-invite' and room.id::text=n.data->>'subjectId'
 left join lateral(select media_id,state from media_requests r where r.user_id=n.user_id and n.kind='request' and (r.id::text=n.data->>'subjectId' or n.source_key like 'seerr:'||r.instance_id||':'||r.external_id||':%') order by updated_at desc limit 1) request on true
 where n.user_id=${userId} and n.kind<>'friend-request' and n.dismissed_at is null and social_notification_visible(${userId}::uuid,n.kind,n.data)
 and (job.id is null or job.state not in ('cancelled','succeeded'))
 ), visible as (
 select n.*,w.category
 from context n left join works w on w.id=n.work_id
 where (${filters.segment}='all' or case when n.kind in ('friend-request','friend-accepted','recommendation','reaction','synced-invite') then 'social' when n.kind in ('request','availability') then 'requests' else 'system' end=${filters.segment})
 and (${filters.kind}='all' or n.kind=${filters.kind}) and (${!filters.unread} or n.read_at is null)
 and (${filters.category}='all' or w.category=${filters.category})
 and (${filters.period}='all' or n.created_at>=now()-case when ${filters.period}='week' then interval '7 days' else interval '30 days' end)
 )`;
}
async function notificationSummary(actor:SessionUser|null){
 const user=requireUser(actor);const [row]=await getSql()`select count(*)::int as count,to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as snapshot from notifications n where user_id=${user.id} and kind<>'friend-request' and read_at is null and dismissed_at is null and social_notification_visible(${user.id}::uuid,n.kind,n.data)
 and not exists(select 1 from outbox_actions job where n.kind='external-action' and job.id::text=split_part(n.source_key,':',2) and job.user_id=n.user_id and job.state in ('cancelled','succeeded'))`;
 return {unread:Number(row.count),snapshot:String(row.snapshot)};
}
export async function notificationUnread(actor:SessionUser|null){return (await notificationSummary(actor)).unread;}
async function hydrate(userId:string,rows:any[]):Promise<NotificationEntry[]>{
 if(!rows.length)return [];
 const ids=[...new Set(rows.flatMap(row=>row.work_id?[String(row.work_id)]:[]))];
 const actorIds=[...new Set(rows.flatMap(row=>row.data?.actorId?[String(row.data.actorId)]:[]))];
 const activityIds=[...new Set(rows.flatMap(row=>row.kind==='reaction'&&row.data?.subjectId?[String(row.data.subjectId)]:[]))];
 const db=getSql();
 const parents:{id:string;root_id:string|null}[]=ids.length?await db`select w.id,coalesce(e.show_id,s.show_id) as root_id from works w left join episodes e on e.media_id=w.id left join seasons s on s.media_id=w.id where w.id in ${db(ids)} and w.kind in ('episode','season')`:[];
 const friendIds=[...new Set(rows.flatMap(row=>row.kind==='friend-accepted'&&row.data?.actorId?[String(row.data.actorId)]:[]))];
 const friendCards=friendIds.length?await friends(userId,1,'accepted',friendIds):[];
 const artworkIds=[...new Set([...ids,...friendCards.flatMap(friend=>friend.backgroundWorkId?[friend.backgroundWorkId]:[]),...parents.flatMap(parent=>parent.root_id?[String(parent.root_id)]:[])])];
 const [cards,assessments,actors,statuses,activity,reactions]=await Promise.all([workCards(userId,userId,artworkIds),workAssessments(userId,userId,ids),actorIds.length?db`select u.id,u.username,case when social_visible(u.id,${userId}::uuid,'details') then u.settings->'profile'->>'avatar' end as avatar from users u where u.id in ${db(actorIds)} and not u.disabled`:[],statusesForUsers(userId,actorIds),activityIds.length?activityFeed(userId,{},activityIds):{items:[]},activityIds.length?db`select target_id,user_id,emoji from social_reactions where target_kind='activity' and target_id in ${db(activityIds)}`:[]]);
 return rows.map(row=>{
  const card=cards.find(card=>('workId' in card?card.workId??card.id:card.id)===row.work_id),assessment=assessments.find(a=>a.id===row.work_id),actor=['friend-request','friend-accepted','recommendation','reaction','synced-invite'].includes(row.kind)?actors.find((actor:any)=>actor.id===row.data?.actorId):null;
  const parent=parents.find(parent=>parent.id===row.work_id);
  const specific=['recommendation','reaction','synced-invite'].includes(row.kind);
  const artworkCard=!specific&&parent?.root_id?cards.find(card=>('workId' in card?card.workId??card.id:card.id)===parent.root_id)??card:card;
  const task=row.provider_kind?serviceTasks(row.provider_kind).find(task=>task.kinds.includes(row.job_kind)):null;
  const jobDestination=row.job_instance&&task?`/settings/jobs#job-${row.job_instance}-${task.id}`:null;
  const href=card?('href' in card?card.href:`/media/${card.id}`):null;
  return {id:row.id,kind:row.kind,title:row.title,body:row.body,createdAt:new Date(row.created_at).toISOString(),readAt:row.read_at?new Date(row.read_at).toISOString():null,locked:row.locked,actor:actor?{username:actor.username,avatar:actor.avatar,status:statuses[actor.id]??'offline'}:null,
   reaction:row.kind==='reaction'?reactions.find((reaction:{target_id:string;user_id:string;emoji:string})=>reaction.target_id===row.data?.subjectId&&reaction.user_id===row.data?.actorId)?.emoji??null:null,
   activity:row.kind==='reaction'?activity.items.find(item=>item.captionActivity?.id===row.data?.subjectId)??null:null,
   friend:row.kind==='friend-accepted'?(()=>{const friend=friendCards.find(friend=>friend.userId===row.data?.actorId);const background=cards.find(card=>('workId' in card?card.workId??card.id:card.id)===friend?.backgroundWorkId);return friend?{...friend,backgroundArtwork:background?.backdrop??background?.poster??undefined}:null;})():null,
   media:card&&!['friend-request','friend-accepted'].includes(row.kind)?{card:artworkCard??card,id:row.work_id,title:card.title,href:href!,artwork:artworkCard?.artwork?.thumb??artworkCard?.backdrop??artworkCard?.poster??null,availability:assessment?.availability??'unknown',stale:assessment?.stale??false}:null,
   sourceLabel:row.service_name?`${row.service_name}${task?' · '+task.title:''}`:null,
   destination:jobDestination??notificationDestination(row.kind,row.data?.destination)??(row.kind==='availability'?href:null),requestState:row.request_state??null,sessionState:row.session_state??null,
   actions:row.kind==='friend-request'?['accept','decline']:row.kind==='recommendation'?['save','dismiss']:row.kind==='synced-invite'?['decline']:[],subjectId:row.data?.subjectId??null};
 });
}
export async function notificationInbox(actor:SessionUser|null,input:unknown={}){
 const user=requireUser(actor),filters=notificationFilters(input);
 const cursor=v.parse(v.object({before:v.optional(v.pipe(v.string(),v.isoTimestamp())),beforeId:v.optional(uuid)}),input);
 if(!!cursor.before!==!!cursor.beforeId)throw new AppError(400,'Choose a complete notification cursor.');
 const [summaryRow]=await getSql()`${visible(user.id,filters)} select count(*) filter(where read_at is null)::int as unread,to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as snapshot from visible`;
 const summary={unread:Number(summaryRow.unread),snapshot:String(summaryRow.snapshot)};
 const rows=await getSql()`${visible(user.id,filters)}
 select n.*,to_char(n.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at from visible n
 where (${cursor.before??null}::timestamptz is null or (n.created_at,n.id)<(${cursor.before??null}::timestamptz,${cursor.beforeId??null}::uuid)) order by n.created_at desc,n.id desc limit 61`;
 const page=Array.from(rows).slice(0,60) as any[],last=page.at(-1);
 return {items:await hydrate(user.id,page),hasMore:rows.length>60,next:last?{before:String(last.cursor_at),beforeId:last.id}:null,...summary};
}
export async function markNotification(actor:SessionUser|null,id:string,action:'read'|'dismiss'){
 const user=requireUser(actor);v.parse(uuid,id);
 const rows=await getSql()`${visible(user.id)} update notifications n set read_at=coalesce(n.read_at,now()),dismissed_at=case when ${action}='dismiss' then now() else n.dismissed_at end
 where n.user_id=${user.id} and n.id=${id} and n.id in(select id from visible) returning n.id`;
 if(!rows.length)throw new AppError(404,'Notification no longer available.');
 return {updated:rows.length};
}
export async function markNotificationsRead(actor:SessionUser|null,input:unknown){
 const user=requireUser(actor),filters=notificationFilters(input);
 const {snapshot}=v.parse(v.object({snapshot:v.pipe(v.string(),v.isoTimestamp())}),input);
 const rows=await getSql()`${visible(user.id,filters)} update notifications n set read_at=now() where n.user_id=${user.id} and n.id in(select id from visible where read_at is null and created_at<=${snapshot}::timestamptz) returning n.id`;
 return {updated:rows.length};
}

export async function markNotificationsSeen(actor:SessionUser|null,input:unknown){
 const user=requireUser(actor),{ids}=v.parse(v.object({ids:v.pipe(v.array(uuid),v.minLength(1),v.maxLength(60))}),input);
 const rows=await getSql()`${visible(user.id)} update notifications n set read_at=coalesce(n.read_at,now()) where n.user_id=${user.id} and n.id in(select id from visible where id=any(${getSql().array(ids,'TEXT')}::uuid[])) returning n.id`;
 return {ids:rows.map((row:{id:string})=>row.id)};
}
