import {statusesForUsers} from './status.server';
import {activityAction} from './model';
import {getDb} from '$lib/server/db';
import {sql} from 'drizzle-orm';
import * as v from 'valibot';
import {workCards} from '$lib/collection/query.server';
const uuid=v.pipe(v.string(),v.uuid());
export const feedOptionsSchema=v.object({category:v.optional(v.picklist(['all','screen','music','game']),'all'),kind:v.optional(v.pipe(v.string(),v.maxLength(40)),'all'),friendId:v.optional(uuid),beforeKnown:v.optional(v.picklist(['true','false'])),period:v.optional(v.picklist(['month','year','all']),'all'),before:v.optional(v.pipe(v.string(),v.isoTimestamp())),beforeId:v.optional(uuid)});
export async function activityFeed(userId:string,raw:unknown={},activityIds?:string[]) {
 if(activityIds)v.parse(v.pipe(v.array(uuid),v.maxLength(60)),activityIds);
 const o=v.parse(feedOptionsSchema,raw);
 const rows=await getDb().execute<{id:string;userId:string;username:string;workId:string;eventKind:string;occurredAt:string;count:number;members:string[];dateKnown:boolean;displayWorkId:string;rootId:string;avatar:string|null;episodeCodes:string[];rating:number|null;minutes:number|null;rewatch:boolean;trackTitle:string|null;listenNumber:number}>(sql`
 with visible_raw as (
  select a.*,w.category,w.kind,u.username,coalesce(e.show_id,se.show_id,r.parent_id,a.work_id) as root_id,
   case when e.media_id is not null then 'S'||lpad(e.season_number::text,greatest(2,length(e.season_number::text)),'0')||'E'||lpad(e.episode_number::text,greatest(2,length(e.episode_number::text)),'0') end as episode_code,
   rating.value as rating, session.minutes_played as minutes,coalesce(tracking.rewatch,false) as rewatch,music.title as track_title
  from social_activity a join works w on w.id=a.work_id join users u on u.id=a.user_id
  left join music_works music on music.id=a.work_id
  left join ratings rating on a.event_kind='rating' and rating.user_id=a.user_id and rating.media_id=a.work_id
  left join game_sessions session on session.id=substring(a.source_key from '^game_sessions:([0-9a-f-]{36})$')::uuid
  left join tracking_events tracking on tracking.id=substring(a.source_key from '^tracking_events:([0-9a-f-]{36})$')::uuid
  left join episodes e on e.media_id=a.work_id
  left join seasons se on se.media_id=a.work_id
  left join lateral(select parent_id from media_relationships where child_id=a.work_id and kind='contains' order by position limit 1) r on true
  where (a.user_id=${userId}::uuid or exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(${userId}::uuid,a.user_id) and f.user_b=greatest(${userId}::uuid,a.user_id)))
   and social_visible(a.user_id,${userId}::uuid,a.section,w.category)
   and (${activityIds===undefined} or a.id in (${activityIds?.length?sql.join(activityIds.map(id=>sql`${id}::uuid`),sql`, `):sql`null::uuid`}))
   and (${o.category}='all' or w.category=${o.category}) and (${o.kind}='all' or a.event_kind=${o.kind})
   and (${o.friendId??null}::uuid is null or a.user_id=${o.friendId??null}::uuid)
   and (w.category='screen' or (w.category='music' and coalesce((select value->>'experimentalMusic' from system_settings where key='coast'),'false')='true') or (w.category='game' and coalesce((select value->>'experimentalGaming' from system_settings where key='coast'),'false')='true'))
 ), deduplicated as (
 select *,row_number() over(partition by user_id,case when source='jellyfin' and event_kind='watch' and date_known then work_id::text||':'||occurred_at::text else id::text end order by created_at,id) as observation_rank from visible_raw
 ), visible as (select *,sum(case when event_kind='listen' and date_known then 1 else 0 end) over(partition by user_id,work_id order by occurred_at,id) as listen_number,lag(occurred_at) over(partition by user_id,root_id order by occurred_at,id) as previous_date from deduplicated where observation_rank=1), numbered as (
  select *,sum(case when previous_date is null or occurred_at-previous_date>interval '3 hours' then 1 else 0 end) over(partition by user_id,root_id order by occurred_at,id) as run from visible
 ), keyed as (
 select *,event_kind as display_kind,
 case when ${activityIds!==undefined} then id::text when event_kind='listen' and batch_key is not null and date_known then 'album:'||batch_key
 when kind='episode' and event_kind='watch' and date_known then 'episode:'||root_id||':'||run else id::text end as group_key from numbered
 ), grouped as (
 select (array_agg(id order by occurred_at desc,id desc))[1] as id,user_id,username,
 (array_agg(work_id order by occurred_at desc,id desc))[1] as work_id,
 (array_agg(root_id order by occurred_at desc,id desc))[1] as root_id,
 case when count(*)=1 and bool_or(kind='episode') then (array_agg(work_id order by occurred_at desc,id desc))[1] else (array_agg(root_id order by occurred_at desc,id desc))[1] end as display_work_id,
 coalesce(array_agg(episode_code order by occurred_at,id) filter(where episode_code is not null),'{}'::text[]) as episode_codes,display_kind as event_kind,
 max(occurred_at) as occurred_at,
 max(track_title) as track_title,max(listen_number)::int as listen_number,max(rating) as rating,sum(minutes)::int as minutes,bool_or(rewatch) as rewatch,count(*)::int as count,array_agg(id order by occurred_at,id) as members,bool_and(date_known) as date_known
 from keyed group by user_id,username,display_kind,group_key
 )
 select id,user_id as "userId",username,work_id as "workId",event_kind as "eventKind",occurred_at as "occurredAt",count,members,rating,minutes,rewatch,track_title as "trackTitle",listen_number as "listenNumber",date_known as "dateKnown",display_work_id as "displayWorkId",root_id as "rootId",episode_codes as "episodeCodes",
 case when social_visible(user_id,${userId}::uuid,'details') then (select settings->'profile'->>'avatar' from users where users.id=grouped.user_id) end as avatar from grouped
 where (${o.period}='all' or occurred_at>=now()-case when ${o.period}='year' then interval '1 year' else interval '30 days' end) and (${o.before??null}::timestamptz is null or
 (date_known,occurred_at,id)<(coalesce(${o.beforeKnown??null}::boolean,true),${o.before??null}::timestamptz,coalesce(${o.beforeId??null}::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 order by date_known desc,occurred_at desc,id desc limit 61`);
 const page=Array.from(rows).slice(0,60),cards=await workCards(userId,userId,[...new Set(page.flatMap(r=>[r.displayWorkId,r.rootId]))]);
 const [statuses,reactions]=await Promise.all([statusesForUsers(userId,page.map(event=>event.userId)),reactionSummary(userId,'activity',page.map(event=>event.id))]);
 const items=page.flatMap(event=>{
   const item=cards.find(c=>('workId' in c?c.workId??c.id:c.id)===event.displayWorkId);
   if(!item)return [];
   const extras=[event.eventKind==='listen'&&event.count===1?event.trackTitle:null,event.eventKind==='listen'&&event.count===1&&event.listenNumber>1?`Listen ${event.listenNumber}`:null,event.rating!=null?`${event.rating}/5`:null,event.minutes!=null?`${event.minutes} minutes`:null,event.rewatch?'Rewatch':null].filter(Boolean);
   const episodeCount=new Set(event.episodeCodes).size;
   const action=event.eventKind==='watch'&&episodeCount>0?`Watched ${episodeCount} ${episodeCount===1?'episode':'episodes'}`:activityAction(event.eventKind);
   const root=cards.find(c=>('workId' in c?c.workId??c.id:c.id)===event.rootId);
   const detail=[event.eventKind==='watch'&&episodeCount>0?`${episodeCount} ${episodeCount===1?'episode':'episodes'}`:event.count>1?`${event.count} ${event.eventKind==='listen'?'tracks':'items'}`:null,...extras].filter(Boolean).join(' · ');
   return [{...item,captionTitle:item.kind==='episode'?root?.title??item.title:item.title,entryId:event.id,captionActivity:{myReaction:reactions[event.id]?.find(reaction=>reaction.mine)?.emoji??null,id:event.id,occurredAt:new Date(event.occurredAt).toISOString(),dateKnown:event.dateKnown,kind:event.eventKind,action:activityAction(event.eventKind),detail},captionActor:{username:event.username,avatar:event.avatar,status:statuses[event.userId]??'offline'},captionSubtitle:`${action}${episodeCount===0&&event.count>1?` · ${event.count} ${event.eventKind==='listen'?'tracks':'items'}`:''}${extras.length?` · ${extras.join(' · ')}`:''}`}];
 });
 const last=page.at(-1);
 return {items,events:page,hasMore:rows.length>60,next:last?{before:new Date(last.occurredAt).toISOString(),beforeId:last.id,beforeKnown:String(last.dateKnown)}:null};
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
 where (w.category='screen' or (w.category='music' and coalesce((select value->>'experimentalMusic' from system_settings where key='coast'),'false')='true') or (w.category='game' and coalesce((select value->>'experimentalGaming' from system_settings where key='coast'),'false')='true')) and exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(${userId}::uuid,u.id) and f.user_b=greatest(${userId}::uuid,u.id)) and social_visible(u.id,${userId}::uuid,r.section,w.category)
 order by d.root,u.username`);
 const reactions=await getDb().execute<{targetId:string;emoji:string;count:number}>(sql`select r.target_id as "targetId",r.emoji,count(*)::int as count from social_reactions r join works w on w.id=r.target_id where r.target_kind='work' and r.target_id in (${list}) and social_visible(r.user_id,${userId}::uuid,'reactions',w.category) group by r.target_id,r.emoji`);
 const socialFriends=Array.from(rows) as {workId:string;userId:string;username:string;avatar:string|null;rating:number|null;watched:boolean;progress:number}[];
 const statuses=await statusesForUsers(userId,socialFriends.map(row=>row.userId));
 return Object.fromEntries(ids.map(id=>{const friends=socialFriends.filter(r=>r.workId===id).map(row=>({...row,status:statuses[row.userId]??'offline'}));return [id,{friends:friends.slice(0,3),total:friends.length,reactions:Array.from(reactions).filter(r=>r.targetId===id)}];}));
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
 and (w.category='screen' or (w.category='music' and coalesce((select value->>'experimentalMusic' from system_settings where key='coast'),'false')='true') or (w.category='game' and coalesce((select value->>'experimentalGaming' from system_settings where key='coast'),'false')='true'))
 group by r.target_id,r.emoji`);
 return Object.fromEntries(ids.map(id=>[id,Array.from(rows).filter(row=>row.targetId===id)]));
}
