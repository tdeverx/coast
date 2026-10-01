import {getDb} from '$lib/server/db';
import {sql} from 'drizzle-orm';
import * as v from 'valibot';
import {workCards} from '$lib/collection/query.server';
const uuid=v.pipe(v.string(),v.uuid());
export const feedOptionsSchema=v.object({category:v.optional(v.picklist(['all','screen','music','game']),'all'),kind:v.optional(v.pipe(v.string(),v.maxLength(40)),'all'),friendId:v.optional(uuid),period:v.optional(v.picklist(['month','year','all']),'month'),before:v.optional(v.pipe(v.string(),v.isoTimestamp())),beforeId:v.optional(uuid)});
export async function activityFeed(userId:string,raw:unknown={}) {
 const o=v.parse(feedOptionsSchema,raw);
 const rows=await getDb().execute<{id:string;userId:string;username:string;workId:string;eventKind:string;occurredAt:string;count:number;members:string[];dateKnown:boolean}>(sql`
 with visible as (
  select a.*,w.category,w.kind,u.username,coalesce(e.show_id,r.parent_id,a.work_id) as root_id,
   count(*) over(partition by a.user_id,a.batch_key) as batch_count,
   lag(a.occurred_at) over(partition by a.user_id,e.show_id order by a.occurred_at,a.id) as previous_date
  from social_activity a join works w on w.id=a.work_id join users u on u.id=a.user_id
  left join episodes e on e.media_id=a.work_id
  left join lateral(select parent_id from media_relationships where child_id=a.work_id and kind='contains' order by position limit 1) r on true
  where exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(${userId}::uuid,a.user_id) and f.user_b=greatest(${userId}::uuid,a.user_id))
   and social_visible(a.user_id,${userId}::uuid,a.section,w.category)
   and (${o.category}='all' or w.category=${o.category}) and (${o.kind}='all' or a.event_kind=${o.kind})
   and (${o.friendId??null}::uuid is null or a.user_id=${o.friendId??null}::uuid)
   and (w.category='screen' or coalesce((select value->>'experimentalFeatures' from system_settings where key='coast'),'false')='true')
 ), numbered as (
  select *,sum(case when previous_date is null or occurred_at-previous_date>interval '1 hour' then 1 else 0 end) over(partition by user_id,root_id order by occurred_at,id) as run from visible
 ), keyed as (
 select *,case when batch_key is not null and source<>'coast' and batch_count>20 then 'import' else event_kind end as display_kind,
 case when batch_key is not null and source<>'coast' and batch_count>20 then 'import:'||batch_key
 when event_kind='listen' and batch_key is not null then 'album:'||batch_key
 when kind='episode' and event_kind='watch' then 'episode:'||root_id||':'||run else id::text end as group_key from numbered
 ), grouped as (
 select (array_agg(id order by occurred_at desc,id desc))[1] as id,user_id,username,
 (array_agg(work_id order by occurred_at desc,id desc))[1] as work_id,display_kind as event_kind,
 case when display_kind='import' then max(created_at) else max(occurred_at) end as occurred_at,
 count(*)::int as count,array_agg(id order by occurred_at,id) as members,bool_and(date_known) as date_known
 from keyed group by user_id,username,display_kind,group_key
 )
 select id,user_id as "userId",username,work_id as "workId",event_kind as "eventKind",occurred_at as "occurredAt",count,members,date_known as "dateKnown" from grouped
 where (${o.period}='all' or occurred_at>=now()-case when ${o.period}='year' then interval '1 year' else interval '30 days' end) and (${o.before??null}::timestamptz is null or (occurred_at,id)<(${o.before??null}::timestamptz,coalesce(${o.beforeId??null}::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 order by occurred_at desc,id desc limit 61`);
 const page=Array.from(rows).slice(0,60),cards=await workCards(userId,userId,[...new Set(page.map(r=>r.workId))]);
 const items=page.flatMap(event=>{const item=cards.find(c=>('workId' in c?c.workId??c.id:c.id)===event.workId);return item?[{...item,entryId:event.id,captionSubtitle:`${event.username} · ${event.eventKind==='import'?`Imported ${event.count} items`:event.eventKind}${event.count>1&&event.eventKind!=='import'?` · ${event.count} items`:''}${!event.dateKnown?' · Date unknown':''}`}]:[];});
 const last=page.at(-1);
 return {items,events:page,hasMore:rows.length>60,next:last?{before:new Date(last.occurredAt).toISOString(),beforeId:last.id}:null};
}
export async function workSocial(userId:string,ids:string[]) {
 v.parse(v.pipe(v.array(uuid),v.maxLength(60)),ids);if(!ids.length)return {};
 const list=sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`);
 const rows=await getDb().execute<{workId:string;userId:string;username:string;avatar:string|null;rating:number|null;watched:boolean;progress:number}>(sql`
 with recursive edges(parent_id,child_id) as (select parent_id,child_id from media_relationships union select show_id,media_id from episodes union select show_id,media_id from seasons), descendants(root,id) as(select id,id from works where id in (${list}) union select d.root,e.child_id from descendants d join edges e on e.parent_id=d.id), ancestors(root,id) as(select id,id from works where id in (${list}) union select a.root,e.parent_id from ancestors a join edges e on e.child_id=a.id), reasons as (
 select user_id,media_id as id,'collection' as section from tracking_state where collected or watchlist
 union select user_id,media_id,'favourites' from tracking_state where favourite
 union select user_id,media_id,'activity' from tracking_state where watched or play_count>0 or dropped
 union select user_id,media_id,'progress' from tracking_state where position_seconds>0
 union select user_id,media_id,'collection' from up_next
 union select l.user_id,i.media_id,'collection' from list_items i join lists l on l.id=i.list_id
 union select user_id,track_id,'progress' from music_progress where position_seconds>0 or play_count>0
 union select t.user_id,a.root,'collection' from tracking_state t join ancestors a on a.id=t.media_id where t.collected
 union select user_id,media_id,'ratings' from ratings
 union select user_id,track_id,'activity' from music_listens
 union select user_id,game_id,'activity' from game_playthroughs where status<>'planned' or progress_percent>0 or exists(select 1 from game_sessions s where s.playthrough_id=game_playthroughs.id)
 )
 select distinct d.root as "workId",u.id as "userId",u.username,
 case when social_visible(u.id,${userId}::uuid,'details') then u.settings->'profile'->>'avatar' end as avatar,
 case when social_visible(u.id,${userId}::uuid,'ratings',w.category) then rating.value end as rating,
 case when social_visible(u.id,${userId}::uuid,'activity',w.category) then coalesce(t.watched,false) else false end as watched,
 case when social_visible(u.id,${userId}::uuid,'progress',w.category) then coalesce(t.position_seconds,0) else 0 end as progress
 from descendants d join reasons r on r.id=d.id join works w on w.id=d.id join users u on u.id=r.user_id
 left join ratings rating on rating.user_id=u.id and rating.media_id=d.root left join tracking_state t on t.user_id=u.id and t.media_id=d.root
 where (w.category='screen' or coalesce((select value->>'experimentalFeatures' from system_settings where key='coast'),'false')='true') and exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(${userId}::uuid,u.id) and f.user_b=greatest(${userId}::uuid,u.id)) and social_visible(u.id,${userId}::uuid,r.section,w.category)
 order by d.root,u.username`);
 const reactions=await getDb().execute<{targetId:string;emoji:string;count:number}>(sql`select r.target_id as "targetId",r.emoji,count(*)::int as count from social_reactions r join works w on w.id=r.target_id where r.target_kind='work' and r.target_id in (${list}) and social_visible(r.user_id,${userId}::uuid,'reactions',w.category) group by r.target_id,r.emoji`);
 return Object.fromEntries(ids.map(id=>{const friends=Array.from(rows).filter(r=>r.workId===id);return [id,{friends:friends.slice(0,3),total:friends.length,reactions:Array.from(reactions).filter(r=>r.targetId===id)}];}));
}

/** Batch reads share the same visibility predicate as activity and media indicators. */
export async function reactionSummary(userId:string,targetKind:'work'|'activity',ids:string[]) {
 v.parse(v.pipe(v.array(uuid),v.maxLength(60)),ids);if(!ids.length)return {};
 const targets=sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`);
 const rows=await getDb().execute<{targetId:string;emoji:string;count:number;mine:boolean}>(sql`
 select r.target_id as "targetId",r.emoji,count(*)::int as count,bool_or(r.user_id=${userId}) as mine
 from social_reactions r
 left join social_activity a on r.target_kind='activity' and a.id=r.target_id
 join works w on w.id=case when r.target_kind='work' then r.target_id else a.work_id end
 where r.target_kind=${targetKind} and r.target_id in (${targets})
 and (r.target_kind='work' or social_visible(a.user_id,${userId}::uuid,a.section,w.category))
 and social_visible(r.user_id,${userId}::uuid,'reactions',w.category)
 and (w.category='screen' or coalesce((select value->>'experimentalFeatures' from system_settings where key='coast'),'false')='true')
 group by r.target_id,r.emoji`);
 return Object.fromEntries(ids.map(id=>[id,Array.from(rows).filter(row=>row.targetId===id)]));
}
