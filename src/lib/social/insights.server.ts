import { requireFeature } from '#lib/server/features.js';
import * as v from 'valibot';
import {tasteRootJoin} from './taste-root.server';
import {workTasteFeatures} from './work-features.server';
import {getSql} from '#lib/server/db/index.js';
import {trackReadQuery,withReadCancellation} from '#lib/server/db/read-cancellation.js';
import {requireFriend} from './service.server';
import {requireVisible} from './privacy.server';
import {comparisonMediaValues,median,sharedTasteSignals,type SharedTasteEvidence} from './taste';
import {tasteMedia,type TasteMedium} from './taste-profile';
import {trainTasteV2,type TasteV2Observation,type TasteV2Features} from './taste-v2';
import {compareVisibleTastesV2} from './friend-taste-v2';
import {AppError} from '#lib/server/security/errors.js';
const friendTasteOptions=v.object({page:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(100000)),1),medium:v.optional(v.picklist(comparisonMediaValues),'all'),overlap:v.optional(v.picklist(['shared','onlyYou','onlyFriend']),'shared')});
type FriendTasteOptions={page?:number;medium?:string;overlap?:'shared'|'onlyYou'|'onlyFriend'};
type VisibleSample={id:string;userId:string;medium:string;kind:string;rating:number|null;ratingSupport:number;reaction:string|null;
 endorsed:boolean;consumed:boolean;dropped:boolean;repeated:boolean;features?:TasteV2Features};
const preferenceLimit=300;

function comparisonScope(viewer:string,friend:string) {
 const sql=getSql();
 return trackReadQuery(()=>sql<{category:string;sections:boolean[];region:string}[]>`
   select c.category,coalesce(nullif(viewer.settings->>'region',''),'GB') as region,array(select social_visible(${friend}::uuid,${viewer}::uuid,s.name,c.category)
     from unnest(array['ratings','activity','progress','favourites','collection','reactions']) s(name)) as sections
   from unnest(array['screen','game','music','book','comic']) c(category) join users viewer on viewer.id=${viewer}::uuid and not viewer.disabled
   where social_visible(${friend}::uuid,${viewer}::uuid,'insights',c.category)
     and exists(select 1 from friendships f where f.user_a=least(${friend}::uuid,${viewer}::uuid)
       and f.user_b=greatest(${friend}::uuid,${viewer}::uuid) and f.state='accepted')
     and coast_feature_enabled(${viewer}::uuid,'personalisation') and coast_feature_enabled(${friend}::uuid,'personalisation')
     and coast_feature_enabled(${viewer}::uuid,'social') and coast_feature_enabled(${friend}::uuid,'social')
   order by c.category`);
}

function publicAffinities(medium:TasteMedium,rows:VisibleSample[]) {
 const independent=rows.map((r):TasteV2Observation=>({
   features:r.features??{},work:{id:r.id,kind:r.kind,medium,rating:r.rating??null,ratingReliability:r.ratingSupport,
     chosen:r.consumed||!!r.endorsed,consumed:r.consumed,repeated:r.repeated,dropped:!!r.dropped,implicit:0,
     explicit:r.endorsed?5:['❤️','🔥'].includes(r.reaction??'')?4:0}
 }));
 return trainTasteV2(medium,independent,{stage:'combined',ordinal:false}).affinities;
}
export function friendInsights(viewerId:string,friendId:string,options:FriendTasteOptions={},signal?:AbortSignal) {
 return withReadCancellation(signal,()=>readFriendInsights(viewerId,friendId,v.parse(friendTasteOptions,options)));
}
async function readFriendInsights(viewerId:string,friendId:string,options:v.InferOutput<typeof friendTasteOptions>) {
 const config=await requireFeature(viewerId,'personalisation');await requireFeature(friendId,'personalisation');
 await requireFriend(viewerId,friendId);await requireVisible(friendId,viewerId,'insights');
 const scope=await comparisonScope(viewerId,friendId);
 const categories=scope.map(s=>s.category);
 const requestedMedium=tasteMedia.find(m=>m.comparison===options.medium);
 if(requestedMedium&&!categories.includes(requestedMedium.category)) throw new AppError(404,'This taste comparison is private or unavailable.');
 const sql=getSql();
 const evidence=sql`with completed_history as materialized (
 select user_id,track_id as id,count(distinct occurred_at) filter(where occurred_at_known)>1 as repeated from music_listens
  where user_id in (${viewerId},${friendId}) group by user_id,track_id
 union all select user_id,game_id,bool_or(repeat) or count(*)>1 from game_playthroughs
  where user_id in (${viewerId},${friendId}) and status='completed' group by user_id,game_id
 union all select user_id,work_id,count(distinct occurred_at)>1 from reading_history
  where user_id in (${viewerId},${friendId}) and state='completed' group by user_id,work_id
 ), candidates as (
 select user_id,media_id as work_id from tracking_state where user_id in (${viewerId},${friendId}) and (collected or watchlist or favourite or watched or play_count>0 or completed_episodes>0 or position_seconds>0 or dropped or paused)
 union select user_id,media_id from ratings where user_id in (${viewerId},${friendId})
 union select user_id,target_id from social_reactions where user_id in (${viewerId},${friendId}) and target_kind='work'
 union select user_id,id from completed_history
 union select user_id,track_id from music_progress where user_id in (${viewerId},${friendId}) and (position_seconds>0 or play_count>0)
 union select user_id,game_id from game_playthroughs where user_id in (${viewerId},${friendId})
 union select user_id,work_id from reading_progress where user_id in (${viewerId},${friendId})
 ), verified_returns as (
  select user_id,media_id from tracking_events where user_id in (${viewerId},${friendId}) and action='watch'
    and applied and value is distinct from false and rewatch
  group by user_id,media_id having bool_or(source='coast') or count(distinct occurred_at) filter(where occurred_at_known)>=2
 ), access as materialized (
  select u.id, c.category,
    social_visible(u.id,${viewerId}::uuid,'progress',c.category) as progress,
    social_visible(u.id,${viewerId}::uuid,'activity',c.category) as activity,
    social_visible(u.id,${viewerId}::uuid,'ratings',c.category) as ratings,
    social_visible(u.id,${viewerId}::uuid,'reactions',c.category) as reactions,
    social_visible(u.id,${viewerId}::uuid,'collection',c.category) as collection,
    social_visible(u.id,${viewerId}::uuid,'favourites',c.category) as favourites
  from users u cross join (values ('screen'),('music'),('game'),('book'),('comic')) c(category)
  where u.id in (${viewerId},${friendId}) and not u.disabled and coast_feature_enabled(u.id,'social')
    and c.category=any(${sql.array(categories,'TEXT')}::text[])
 ) select u.id as "userId",w.id,case when w.kind='movie' then 'movies' when w.category='screen' then 'tv' else w.category end as medium,
 u.progress as "progressVisible",
 case when u.progress then case w.category
   when 'music' then coalesce(mp.position_seconds,0)
   when 'book' then coalesce(epub.fraction,rp.page,0)
   when 'comic' then coalesce(epub.fraction,rp.page,0)
   else coalesce(t.position_seconds,0) end else 0 end as "position",
 case when u.progress then case w.category
   when 'music' then coalesce(mp.duration_seconds,0)
   when 'book' then case when epub.fraction is not null then 1 else coalesce(rp.total_pages,0) end
   when 'comic' then case when epub.fraction is not null then 1 else coalesce(rp.total_pages,0) end
   else coalesce(t.duration_seconds,0) end else 0 end as "duration",
 case when u.progress then gp.progress_percent end as "gameProgress",
 case when u.progress then coalesce(gp.status,case when rp.state='reading' then 'in-progress' else rp.state end,case when t.dropped then 'dropped' when t.paused then 'paused' end) end as status,
 case when u.ratings then r.value end as rating,
 case when u.reactions then reaction.emoji end as reaction,
 (u.collection and (coalesce(t.collected,false) or coalesce(t.watchlist,false))) or (u.favourites and coalesce(t.favourite,false)) as interest,
 u.favourites and coalesce(t.favourite,false) as endorsed,
 u.activity and (returns.media_id is not null or coalesce(history.repeated,false) or coalesce(mp.play_count,0)>1) as repeated,
 (u.progress and coalesce(rp.state='completed',false)) or (u.activity and (coalesce(t.watched,false) or coalesce(t.play_count,0)>0 or coalesce(t.completed_episodes,0)>0 or coalesce(mp.play_count,0)>0 or history.id is not null)) as consumed
 from candidates c join works w on w.id=c.work_id join access u on u.id=c.user_id and u.category=w.category
 left join music_progress mp on mp.user_id=u.id and mp.track_id=w.id
 left join reading_progress rp on rp.user_id=u.id and rp.work_id=w.id
 left join lateral(select (location->>'fraction')::real as fraction from reading_sessions rs
   where rs.user_id=u.id and rs.work_id=rp.work_id and rs.bookmark_cycle=rp.bookmark_cycle
     and u.progress and rp.total_pages is null and rp.state in ('reading','paused')
     and rs.share_id is null and rs.format='epub' and rs.location is not null
   order by rs.position_updated_at desc nulls last,rs.id desc limit 1) epub on true
 left join lateral(select progress_percent,status from game_playthroughs where user_id=u.id and game_id=w.id order by created_at desc,id desc limit 1) gp on true
 left join tracking_state t on t.user_id=u.id and t.media_id=w.id left join ratings r on r.user_id=u.id and r.media_id=w.id
 left join completed_history history on history.user_id=u.id and history.id=w.id
 left join verified_returns returns on returns.user_id=u.id and returns.media_id=w.id
 left join social_reactions reaction on reaction.user_id=u.id and reaction.target_kind='work' and reaction.target_id=w.id
 where w.kind in ('movie','show','season','episode','album','track','artist','game','book','comic')`;

 // Aggregate exact counts in PostgreSQL. Only a bounded evidence sample and the
 // requested overlap page cross the boundary; feature hydration is never global.
 const requested=Math.max(1,Math.min(100000,Math.floor(options.page??1)));
 const [result]=await trackReadQuery(()=>sql`with raw as (${evidence}), meaningful as materialized (
   select * from raw where rating is not null or reaction is not null or interest or consumed
     or position>0 or status in ('planned','in-progress','paused','dropped')
 ), labelled as materialized (
   select m.*,root.id as root,root.kind as "rootKind" from meaningful m join works w on w.id=m.id ${tasteRootJoin(sql)}
   where m.rating is not null or m.reaction is not null or m.interest or m.consumed or m.status='dropped'
 ), canonical as materialized (
   select "userId",medium,root as id,max("rootKind") as kind,
     coalesce(max(rating) filter(where id=root),percentile_cont(0.5) within group(order by rating)) as rating,
     case when count(rating) filter(where id=root)>0 then 1
       else sqrt(least(1,count(rating)::float8/4)) end as "ratingSupport",
     coalesce(max(reaction) filter(where id=root),mode() within group(order by reaction)) as reaction,
     bool_or(interest) as interest,bool_or(endorsed) as endorsed,bool_or(consumed) as consumed,
     bool_or(status='dropped' and id=root) as dropped,bool_or(repeated and id=root) or count(*) filter(where repeated and id<>root)>=2 as repeated
   from labelled group by "userId",medium,root
 ), aligned as (
   select medium,root,id,
    max(rating) filter(where "userId"=${viewerId}) as mine,max(rating) filter(where "userId"=${friendId}) as theirs,
    max(reaction) filter(where "userId"=${viewerId}) as my_reaction,max(reaction) filter(where "userId"=${friendId}) as their_reaction
   from labelled where rating is not null or reaction is not null group by medium,root,id
 ), matched as (
   -- Agree on the same episode/track first. Each show or album supplies one opinion.
   select medium,root,
    coalesce(max(mine) filter(where id=root and theirs is not null),
      percentile_cont(.5) within group(order by mine) filter(where theirs is not null)) as mine,
    coalesce(max(theirs) filter(where id=root and mine is not null),
      percentile_cont(.5) within group(order by theirs) filter(where mine is not null)) as theirs,
    (jsonb_agg(jsonb_build_array(my_reaction,their_reaction) order by (id=root) desc,id)
      filter(where my_reaction is not null and their_reaction is not null))->0 as reactions
   from aligned where mine is not null and theirs is not null or my_reaction is not null and their_reaction is not null
   group by medium,root
 ), rating_histogram as (
   select medium,mine,theirs,count(*)::int as n from matched where mine is not null group by medium,mine,theirs
 ), evidence_roots as materialized (
   select c.*,coalesce(rating is not null or endorsed or consumed or repeated or dropped or reaction in ('❤️','🔥'),false) as usable
   from canonical c
 ), roots as materialized (
   select medium,id,count(*) filter(where usable) as opinions,
     bool_or(consumed and "userId"=${viewerId}) as mine,bool_or(consumed and "userId"=${friendId}) as theirs,
     bool_or(interest and "userId"=${viewerId}) as my_interest,bool_or(interest and "userId"=${friendId}) as their_interest
   from evidence_roots group by medium,id
 ), sample as (
   select c.*,row_number() over(partition by "userId",c.medium order by
     (rating is not null) desc,endorsed desc,repeated desc,coalesce(dropped,false) desc,id) as rank
   from evidence_roots c join roots using(medium,id) where c.usable and roots.opinions=1
 ), progress as (
   select medium,id,"userId",case when consumed then 100 when "progressVisible" then coalesce("gameProgress",
     case when duration>0 then least(100,100.0*position/duration) when position=0 then 0 end) end as percent from meaningful
 ), pairs as materialized (
   select medium,id,bool_or("userId"=${viewerId}) as yours,bool_or("userId"=${friendId}) as theirs,
     max(percent) filter(where "userId"=${viewerId}) as you,max(percent) filter(where "userId"=${friendId}) as friend
   from progress group by medium,id
 ), selected as (
   select * from pairs where (${options.medium??'all'}='all' or medium=${options.medium??'all'}) and
     case ${options.overlap??'shared'} when 'onlyYou' then yours and not theirs when 'onlyFriend' then theirs and not yours else yours and theirs end
 ), totals as(select count(*)::int as total from selected)
 select total,least(${requested},greatest(1,ceil(total::numeric/60)::int)) as page,
   coalesce((select jsonb_agg(to_jsonb(p)) from (select * from selected order by medium,id limit 60 offset
     (least(${requested},greatest(1,ceil(total::numeric/60)::int))-1)*60) p),'[]'::jsonb) as items,
   coalesce((select jsonb_agg(to_jsonb(p)-'rank'-'usable') from sample p where rank<=${preferenceLimit}),'[]'::jsonb) as sample,
   coalesce((select jsonb_object_agg(medium,to_jsonb(m)-'medium') from (
     select medium,count(mine)::int as works,case when count(mine)>=5 then round((100*(1-avg(abs(mine-theirs))/4.5))::numeric)::int end as score,
       count(reactions)::int as "reactionWorks",case when count(reactions)>=5 then round(100.0*count(*) filter(where reactions->>0=reactions->>1)/count(reactions))::int end as "reactionScore",
       (select jsonb_agg(jsonb_build_array(h.mine,h.theirs,h.n) order by h.mine,h.theirs) from rating_histogram h where h.medium=matched.medium) as ratings
     from matched group by medium) m),'{}') as agreement,
   coalesce((select jsonb_object_agg(medium,to_jsonb(t)-'medium') from (select medium,
      count(*) filter(where mine and theirs)::int as shared,count(*) filter(where mine and not theirs)::int as "onlyYou",count(*) filter(where theirs and not mine)::int as "onlyFriend",
      count(*) filter(where my_interest and their_interest)::int as interests,count(*) filter(where my_interest)::int as "myInterests",count(*) filter(where their_interest)::int as "theirInterests"
      from roots group by medium) t),'{}') as roots,
   coalesce((select jsonb_agg(to_jsonb(p)) from (select medium,"userId",count(*)::int as total,
     count(*) filter(where consumed)::int as completed,count(*) filter(where not coalesce(consumed,false) and position=0 and
       (status='planned' or interest and status is null))::int as planned,
     count(*) filter(where not coalesce(consumed,false) and (position>0 or status in ('in-progress','paused')))::int as active,
     count(*) filter(where status='dropped')::int as dropped,
     count(*) filter(where rating is not null)::int as rated,count(*) filter(where reaction is not null)::int as reacted
     from meaningful group by medium,"userId") p),'[]'::jsonb) as stats,
   coalesce((select jsonb_agg(to_jsonb(p)) from (select medium,count(*) filter(where yours and theirs)::int as shared,
     count(*) filter(where yours and not theirs)::int as "onlyYou",count(*) filter(where theirs and not yours)::int as "onlyFriend"
     from pairs group by medium) p),'[]'::jsonb) as overlaps from totals`);
 const rows=result.sample as VisibleSample[];
 for(const entry of tasteMedia.filter(entry=>categories.includes(entry.category))) {
   const group=rows.filter(row=>row.medium===entry.comparison);
   if(group.filter(row=>row.userId===viewerId).length<2 || group.filter(row=>row.userId===friendId).length<2) continue;
   for(let start=0;start<group.length;start+=128) {
     const batch=group.slice(start,start+128);
     const features=await workTasteFeatures(batch.map(row=>row.id),config.metadataSource,undefined,scope[0]?.region,undefined,true);
     for(const row of batch) row.features=features.get(row.id);
   }
 }
 const empty={total:0,completed:0,planned:0,active:0,dropped:0,rated:0,reacted:0};
 const statistics=result.stats as (typeof empty&{medium:string;userId:string})[];
 const pages=result.items as {id:string;medium:string;yours:boolean;theirs:boolean;you:number|null;friend:number|null}[];
 const overlapCounts=result.overlaps as {medium:string;shared:number;onlyYou:number;onlyFriend:number}[];
 const media=tasteMedia.filter(entry=>categories.includes(entry.category)).map(({value,comparison:medium})=>{
   const left=rows.filter(row=>row.medium===medium&&row.userId===viewerId),right=rows.filter(row=>row.medium===medium&&row.userId===friendId);
   const items=pages.filter(item=>item.medium===medium);
   const agreement=(result.agreement as Record<string,SharedTasteEvidence>)[medium]
      ?? {ratings:[],works:0,score:null,reactionWorks:0,reactionScore:null};
   const compared=compareVisibleTastesV2(publicAffinities(value,left),publicAffinities(value,right),{works:agreement.works,score:agreement.score});
   const roots=(result.roots as Record<string,{shared:number;onlyYou:number;onlyFriend:number;interests:number;myInterests:number;theirInterests:number}>)[medium];
   const viewing={shared:roots?.shared??0,onlyYou:roots?.onlyYou??0,onlyFriend:roots?.onlyFriend??0};
   const stats={you:statistics.find(row=>row.medium===medium&&row.userId===viewerId)??empty,friend:statistics.find(row=>row.medium===medium&&row.userId===friendId)??empty};
   const signals={...sharedTasteSignals(agreement,stats,roots),...compared.byDimension};
   return {medium,score:compared.score,signals,stats,comparison:{viewing,agreement:compared.agreement,preferences:compared.preferences,score:compared.score},
     progressComparisons:items.map(item=>({workId:item.id,you:item.you,friend:item.friend})),
     overlapCounts:overlapCounts.find(row=>row.medium===medium)??{shared:0,onlyYou:0,onlyFriend:0},
     overlap:{shared:items.filter(item=>item.yours&&item.theirs).map(item=>item.id),onlyYou:items.filter(item=>item.yours&&!item.theirs).map(item=>item.id),onlyFriend:items.filter(item=>!item.yours&&item.theirs).map(item=>item.id)}};
 });
 if(JSON.stringify(await comparisonScope(viewerId,friendId))!==JSON.stringify(scope))
   throw new AppError(404,'Sharing settings changed. Reopen this taste comparison.');
 return {friendId,score:median(media.flatMap(m=>m.score===null?[]:[m.score])),media,
   sampleLimit:preferenceLimit,page:Number(result.page),pages:Math.max(1,Math.ceil(result.total/60)),total:result.total,ids:pages.map(item=>item.id)};
}

export async function friendDiscovery(viewerId:string,category:'all'|'screen'|'game'|'music'|'reading'='all'):Promise<{workId:string;friends:number;discoveredAt:Date}[]> {
 await requireFeature(viewerId,'social');
 return getSql()`with visible as (
 select a.user_id,a.occurred_at,coalesce(e.show_id,se.show_id,r.parent_id,a.work_id) as root_id
 from social_activity a join works w on w.id=a.work_id
 left join episodes e on e.media_id=a.work_id
 left join seasons se on se.media_id=a.work_id
 left join lateral(select parent_id from media_relationships where child_id=a.work_id and kind='contains' order by position limit 1) r on w.category='music'
 where coast_feature_enabled(a.user_id,'social') and a.event_kind<>'reading-dropped' and a.occurred_at>=now()-interval '30 days' and a.date_known and social_visible(a.user_id,${viewerId}::uuid,a.section,w.category)
 and (${category}='all' or w.category=${category} or ${category}='reading' and w.category in ('book','comic'))
 and exists(select 1 from friendships f where f.state='accepted' and f.user_a=least(a.user_id,${viewerId}::uuid) and f.user_b=greatest(a.user_id,${viewerId}::uuid))
 ) select root_id as "workId",count(distinct user_id)::int as friends,max(occurred_at) as "discoveredAt"
 from visible group by root_id order by count(distinct user_id) desc,max(occurred_at) desc,root_id limit 60`;
}
