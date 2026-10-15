import * as v from 'valibot';
import {workTasteFeatures} from './work-features.server';
import {getSql} from '$lib/server/db';
import {requireFriend} from './service.server';
import {requireVisible} from './privacy.server';
import {median,tasteSignals,type TasteWork} from './taste';
export async function friendInsights(viewerId:string,friendId:string,options:{page?:number;medium?:string;overlap?:'shared'|'onlyYou'|'onlyFriend'}={}) {
 options=v.parse(v.object({page:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(100000)),1),medium:v.optional(v.picklist(['all','movies','tv','music','game']),'all'),overlap:v.optional(v.picklist(['shared','onlyYou','onlyFriend']),'shared')}),options);
 await requireFriend(viewerId,friendId);await requireVisible(friendId,viewerId,'insights');
 const sql=getSql();
 const evidence=sql`with candidates as (
 select user_id,media_id as work_id from tracking_state where user_id in (${viewerId},${friendId}) and (collected or watchlist or favourite or watched or play_count>0 or position_seconds>0)
 union select user_id,media_id from ratings where user_id in (${viewerId},${friendId})
 union select user_id,target_id from social_reactions where user_id in (${viewerId},${friendId}) and target_kind='work'
 union select user_id,track_id from music_listens where user_id in (${viewerId},${friendId})
 union select user_id,track_id from music_progress where user_id in (${viewerId},${friendId}) and position_seconds>0
 union select user_id,game_id from game_playthroughs where user_id in (${viewerId},${friendId})
 ) select u.id as "userId",w.id,case when w.kind='movie' then 'movies' when w.category='screen' then 'tv' else w.category end as medium,
 coalesce(m.genres,mu.genres,g.genres,'{}'::text[]) as genres,
 case when social_visible(u.id,${viewerId}::uuid,'progress',w.category) then case when w.category='music' then coalesce(mp.position_seconds,0) else coalesce(t.position_seconds,0) end else 0 end as "positionSeconds",
 case when social_visible(u.id,${viewerId}::uuid,'progress',w.category) then case when w.category='music' then coalesce(mp.duration_seconds,0) else coalesce(t.duration_seconds,0) end else 0 end as "durationSeconds",
 case when social_visible(u.id,${viewerId}::uuid,'progress',w.category) then gp.progress_percent end as "gameProgress",
 case when social_visible(u.id,${viewerId}::uuid,'progress',w.category) then gp.status end as "gameStatus",
 case when social_visible(u.id,${viewerId}::uuid,'ratings',w.category) then r.value end as rating,
 case when social_visible(u.id,${viewerId}::uuid,'reactions',w.category) then reaction.emoji end as reaction,
 (social_visible(u.id,${viewerId}::uuid,'collection',w.category) and (coalesce(t.collected,false) or coalesce(t.watchlist,false))) or (social_visible(u.id,${viewerId}::uuid,'favourites',w.category) and coalesce(t.favourite,false)) as interest,
 social_visible(u.id,${viewerId}::uuid,'activity',w.category) and (coalesce(t.watched,false) or coalesce(t.play_count,0)>0 or exists(select 1 from music_listens where user_id=u.id and track_id=w.id) or exists(select 1 from game_playthroughs where user_id=u.id and game_id=w.id and status='completed')) as consumed
 from candidates c join users u on u.id=c.user_id join works w on w.id=c.work_id left join media m on m.id=w.id left join music_works mu on mu.id=w.id left join games g on g.id=w.id
 left join music_progress mp on mp.user_id=u.id and mp.track_id=w.id
 left join lateral(select progress_percent,status from game_playthroughs where user_id=u.id and game_id=w.id order by created_at desc,id desc limit 1) gp on true
 left join tracking_state t on t.user_id=u.id and t.media_id=w.id left join ratings r on r.user_id=u.id and r.media_id=w.id
 left join social_reactions reaction on reaction.user_id=u.id and reaction.target_kind='work' and reaction.target_id=w.id
 where u.id in (${viewerId},${friendId}) and not u.disabled and (w.category='screen' or (w.category='music' and coalesce((select value->>'experimentalMusic' from system_settings where key='coast'),'false')='true') or (w.category='game' and coalesce((select value->>'experimentalGaming' from system_settings where key='coast'),'false')='true'))
 and (t.collected or t.watchlist or t.favourite or t.watched or t.play_count>0 or r.value is not null or reaction.emoji is not null or exists(select 1 from music_listens where user_id=u.id and track_id=w.id) or case when w.category='music' then coalesce(mp.position_seconds,0) else coalesce(t.position_seconds,0) end>0 or gp.status in ('in-progress','paused','completed','dropped'))`;

 // This comparison currently supports screen, music and games. Reading taste profiles
 // are computed separately; unsupported rows must not occupy overlap pages.
 // Aggregate exact counts in PostgreSQL. Only a bounded evidence sample and the
 // requested overlap page cross the boundary; feature hydration is never global.
 const requested=Math.max(1,Math.min(100000,Math.floor(options.page??1)));
 const [result]=await sql`with raw as (${evidence}), meaningful as materialized (
   select * from raw where rating is not null or reaction is not null or interest or consumed
     or "positionSeconds">0 or "gameStatus" in ('in-progress','paused','dropped')
 ), sample as (
   select *,row_number() over(partition by "userId" order by (rating is not null) desc,
     interest desc,consumed desc,id) as rank from meaningful
 ), pairs as materialized (
   select coalesce(a.id,b.id) as id,coalesce(a.medium,b.medium) as medium,a.id is not null as yours,b.id is not null as theirs,
     case when a.consumed then 100 else coalesce(a."gameProgress",case when a."durationSeconds">0 then least(100,100*a."positionSeconds"/a."durationSeconds") else 0 end) end as you,
     case when b.consumed then 100 else coalesce(b."gameProgress",case when b."durationSeconds">0 then least(100,100*b."positionSeconds"/b."durationSeconds") else 0 end) end as friend
   from (select * from meaningful where "userId"=${viewerId}) a
   full join (select * from meaningful where "userId"=${friendId}) b on a.id=b.id
 ), selected as (
   select * from pairs where (${options.medium??'all'}='all' or medium=${options.medium??'all'}) and
     case ${options.overlap??'shared'} when 'onlyYou' then yours and not theirs when 'onlyFriend' then theirs and not yours else yours and theirs end
 ), totals as(select count(*)::int as total from selected)
 select total,least(${requested},greatest(1,ceil(total::numeric/60)::int)) as page,
   coalesce((select jsonb_agg(to_jsonb(p)) from (select * from selected order by medium,id limit 60 offset
     (least(${requested},greatest(1,ceil(total::numeric/60)::int))-1)*60) p),'[]'::jsonb) as items,
   coalesce((select jsonb_agg(to_jsonb(p)-'rank') from sample p where rank<=300),'[]'::jsonb) as sample,
   coalesce((select jsonb_agg(to_jsonb(p)) from (select medium,"userId",count(*)::int as total,
     count(*) filter(where consumed)::int as completed,count(*) filter(where interest and not consumed and "positionSeconds"=0)::int as planned,
     count(*) filter(where not consumed and ("positionSeconds">0 or "gameStatus" in ('in-progress','paused')))::int as active,
     count(*) filter(where rating is not null)::int as rated,count(*) filter(where reaction is not null)::int as reacted
     from meaningful group by medium,"userId") p),'[]'::jsonb) as stats,
   coalesce((select jsonb_agg(to_jsonb(p)) from (select medium,count(*) filter(where yours and theirs)::int as shared,
     count(*) filter(where yours and not theirs)::int as "onlyYou",count(*) filter(where theirs and not yours)::int as "onlyFriend"
     from pairs group by medium) p),'[]'::jsonb) as overlaps from totals`;
 const rows=result.sample as (TasteWork&{userId:string;medium:string})[];
 const features=await workTasteFeatures([...new Set(rows.map(row=>row.id))]);
 for(const row of rows)row.features=features.get(row.id)??{};
 const empty={total:0,completed:0,planned:0,active:0,rated:0,reacted:0};
 const statistics=result.stats as (typeof empty&{medium:string;userId:string})[];
 const pages=result.items as {id:string;medium:string;yours:boolean;theirs:boolean;you:number|null;friend:number|null}[];
 const overlapCounts=result.overlaps as {medium:string;shared:number;onlyYou:number;onlyFriend:number}[];
 const media=['movies','tv','music','game'].map(medium=>{
   const left=rows.filter(row=>row.medium===medium&&row.userId===viewerId),right=rows.filter(row=>row.medium===medium&&row.userId===friendId);
   const items=pages.filter(item=>item.medium===medium);
   return {medium,...tasteSignals(left,right),stats:{you:statistics.find(row=>row.medium===medium&&row.userId===viewerId)??empty,friend:statistics.find(row=>row.medium===medium&&row.userId===friendId)??empty},
     progressComparisons:items.filter(item=>item.yours&&item.theirs).map(item=>({workId:item.id,you:item.you,friend:item.friend})),
     overlapCounts:overlapCounts.find(row=>row.medium===medium)??{shared:0,onlyYou:0,onlyFriend:0},
     overlap:{shared:items.filter(item=>item.yours&&item.theirs).map(item=>item.id),onlyYou:items.filter(item=>item.yours&&!item.theirs).map(item=>item.id),onlyFriend:items.filter(item=>!item.yours&&item.theirs).map(item=>item.id)}};
 });
 return {friendId,score:median(media.flatMap(m=>m.score===null?[]:[m.score])),media,
   sampleLimit:300,page:Number(result.page),pages:Math.max(1,Math.ceil(result.total/60)),total:result.total,ids:pages.map(item=>item.id)};
}

export async function friendDiscovery(viewerId:string,category:'all'|'screen'|'game'|'music'|'reading'='all'):Promise<{workId:string;friends:number;discoveredAt:Date}[]> {
 return getSql()`with visible as (
 select a.user_id,a.occurred_at,coalesce(e.show_id,se.show_id,r.parent_id,a.work_id) as root_id
 from social_activity a join works w on w.id=a.work_id
 left join episodes e on e.media_id=a.work_id
 left join seasons se on se.media_id=a.work_id
 left join lateral(select parent_id from media_relationships where child_id=a.work_id and kind='contains' order by position limit 1) r on w.category='music'
 where a.event_kind<>'reading-dropped' and a.occurred_at>=now()-interval '30 days' and a.date_known and social_visible(a.user_id,${viewerId}::uuid,a.section,w.category)
 and (${category}='all' or w.category=${category} or ${category}='reading' and w.category in ('book','comic'))
 and (w.category='screen' or (w.category='music' and coalesce((select value->>'experimentalMusic' from system_settings where key='coast'),'false')='true') or (w.category='game' and coalesce((select value->>'experimentalGaming' from system_settings where key='coast'),'false')='true') or (w.category='book' and coalesce((select value->>'experimentalBooks' from system_settings where key='coast'),'false')='true') or (w.category='comic' and coalesce((select value->>'experimentalComics' from system_settings where key='coast'),'false')='true'))
 and exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(a.user_id,${viewerId}::uuid) and f.user_b=greatest(a.user_id,${viewerId}::uuid))
 ) select root_id as "workId",count(distinct user_id)::int as friends,max(occurred_at) as "discoveredAt"
 from visible group by root_id order by count(distinct user_id) desc,max(occurred_at) desc,root_id limit 60`;
}
