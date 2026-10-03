import { categoryEnabled } from '$lib/experimental';
import { getSql } from '$lib/server/db';
import { getConfig } from '$lib/server/config';
import { AppError } from '$lib/server/security/errors';
import { workCards } from '$lib/collection/query.server';
import * as v from 'valibot';
import { pagination,PAGE_SIZE } from '$lib/server/queries/pagination';

/** First-pass recommendations use only direct personal evidence and the shared pool. */
export async function experimentalRows(userId:string,feature:string,url:URL){
 const config=await getConfig();
 if(!(feature==='row'?config.experimentalDynamicForYou:feature==='recommendations'?config.experimentalRecommendations:false))throw new AppError(404,'This experiment is disabled.');
 const category=v.parse(v.picklist(['screen','game','music']),url.searchParams.get('category')??'screen');
 const genre=feature==='row'?v.parse(v.pipe(v.string(),v.minLength(1),v.maxLength(100)),url.searchParams.get('genre')):null;
 const available=url.searchParams.get('available')==='true';
 const requested=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10000)),Number(url.searchParams.get('page')??1));
 if(!categoryEnabled(config,category))return {items:[],total:0,page:1,pages:1};
 const sql=getSql();
 const [result]=await sql`with evidence as (
  select w.id,w.kind,coalesce(m.title,g.title,a.title) as title,coalesce(m.genres,g.genres,a.genres,'{}'::text[]) as genres,
    coalesce(r.value,case when t.favourite then 5 else 3 end) as weight
  from works w left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id
  left join tracking_state t on t.media_id=w.id and t.user_id=${userId} left join ratings r on r.media_id=w.id and r.user_id=${userId}
  where w.category=${category} and (t.favourite or t.watched or (${feature}='row' and t.watchlist) or r.value>=3.5 or exists(select 1 from music_progress p where p.track_id=w.id and p.user_id=${userId} and (p.play_count>0 or (${feature}='row' and p.position_seconds>0))) or exists(select 1 from music_listens l where l.track_id=w.id and l.user_id=${userId}) or exists(select 1 from game_playthroughs p where p.game_id=w.id and p.user_id=${userId} and (p.status='completed' or (${feature}='row' and p.status<>'dropped')))) and not coalesce(t.dropped,false)
  order by coalesce(t.updated_at,r.updated_at,w.created_at) desc limit 100
 ), candidates as (
  select w.id,coalesce(m.genres,g.genres,a.genres,'{}'::text[]) as genres
  from works w left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id
  where w.category=${category} and w.kind in ('movie','show','game','album')
  and (${genre}::text is null or ${genre}::text=any(coalesce(m.genres,g.genres,a.genres,'{}'::text[])))
  and not exists(select 1 from tracking_state t where t.media_id=w.id and t.user_id=${userId} and (t.watched or t.dropped or t.watchlist or t.collected))
  and not exists(select 1 from evidence e where e.id=w.id)
  and (not ${available} or exists(select 1 from availability av join provider_connections pc on pc.id=av.connection_id join provider_instances pi on pi.id=pc.instance_id where av.media_id=w.id and av.user_id=${userId} and av.state='available' and pc.status='connected' and pi.enabled))
  and (m.release_date is null or m.release_date<=current_date) and (g.release_date is null or g.release_date<=current_date) and (a.release_date is null or a.release_date<=current_date)
  order by w.id limit 2000
 ), matches as (
  select c.id,e.title as seed,e.weight,count(*) as overlap from candidates c join evidence e on c.genres && e.genres
  cross join lateral unnest(c.genres) genre where genre=any(e.genres) group by c.id,e.id,e.title,e.weight
 ), scored as (select id,sum(overlap*weight) as score,(array_agg(seed order by overlap*weight desc,seed))[1] as seed from matches group by id), totals as(select count(*)::int as total from scored)
 select total,coalesce((select jsonb_agg(row_to_json(p)) from(select id,score,seed from scored order by score desc,id limit ${PAGE_SIZE} offset (least(${requested},greatest(1,ceil(total::numeric/${PAGE_SIZE})::int))-1)*${PAGE_SIZE})p),'[]'::jsonb) as candidates from totals`;
 const candidates=result.candidates as {id:string;seed:string;score:number}[];
 const byId=new Map(candidates.map(candidate=>[candidate.id,candidate]));
 const cards=await workCards(userId,userId,candidates.map(item=>item.id));
 return {...pagination(result.total,requested),total:result.total,items:cards.map(item=>({...item,captionSubtitle:`Shared genres with ${byId.get(('workId' in item?item.workId:undefined)??item.id)?.seed??'your tracked titles'}`}))};
}
