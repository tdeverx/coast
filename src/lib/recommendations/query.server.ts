import {categoryEnabled} from '$lib/experimental';
import {getSql} from '$lib/server/db/index';
import {getConfig} from '$lib/server/config';
import {AppError} from '$lib/server/security/errors';
import {workCards} from '$lib/collection/query.server';
import * as v from 'valibot';
import {pagination,PAGE_SIZE} from '$lib/server/queries/pagination';
import {tasteRevisionSql} from '$lib/social/taste-cache.server';
import {getDb} from '$lib/server/db/index';
import {sql as drizzleSql} from 'drizzle-orm';
import {interestWorks} from './interests.server';
import {genreRowTitle,relatedRowTitle,recommendationRowTitle} from './row-titles';
import {genreReason} from './row-ranking';
import type {GenreReason} from './model';
/** Provider suggestions are read from cache; page reads never perform remote requests. */
export async function recommendationRows(userId:string,feature:string,url:URL){
 const config=await getConfig();if(feature!=='row'&&feature!=='recommendations')throw new AppError(404,'Unknown recommendation source.');
 const category=v.parse(v.picklist(['screen','game','music','reading']),url.searchParams.get('category')??'screen');
 const workId=feature==='row'&&url.searchParams.has('work')?v.parse(v.pipe(v.string(),v.uuid()),url.searchParams.get('work')):null;
 const kind=feature==='row'&&url.searchParams.has('kind')?v.parse(v.picklist(['movie','show','game','album','book','comic']),url.searchParams.get('kind')):null;
 const genre=feature==='row'&&!workId?v.parse(v.pipe(v.string(),v.minLength(1),v.maxLength(100)),url.searchParams.get('genre')):null;
 const reason=v.parse(v.picklist(['liked','watched','saved','explore']),url.searchParams.get('reason')??'saved') as GenreReason;
 const orderSeed=url.searchParams.has('seed')?v.parse(v.pipe(v.string(),v.minLength(1),v.maxLength(64),v.regex(/^[a-zA-Z0-9-]+$/)),url.searchParams.get('seed')):`${userId}:${new Date().toISOString().slice(0,10)}`;
 const available=url.searchParams.get('available')==='true';
 const requested=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(10000)),Number(url.searchParams.get('page')??1));
 if(!categoryEnabled(config,category))return {items:[],total:0,page:1,pages:1,title:undefined as string|undefined};
 const interests=(await interestWorks(userId)).filter(work=>work.category===category&&(work.kind!=='book'||config.experimentalBooks)&&(work.kind!=='comic'||config.experimentalComics));
 const positive=interests.filter(work=>work.weight>0&&(!workId||work.id===workId)).slice(0,100);
 const ids=positive.map(work=>work.id),weights=positive.map(work=>work.weight);
 const negative=interests.filter(work=>work.weight<0).flatMap(work=>work.genres);
 const [revision]=await getDb().execute<{revision:string}>(drizzleSql`select ${tasteRevisionSql} as revision from users u where u.id=${userId}::uuid`);
 const sql=getSql();
 const [result]=await sql`with evidence as (
  select w.id,e.weight,coalesce(m.genres,g.genres,a.genres,b.subjects,'{}'::text[]) as genres,coalesce(b.authors,'{}'::text[]) as authors,b.series_title as series from unnest(${sql.array(ids,'UUID')}::uuid[],${sql.array(weights,'FLOAT8')}::float[]) e(id,weight) join works w on w.id=e.id left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id left join reading_works b on b.id=w.id
 ), provider_matches as (
  select item.id,max(coalesce(e.weight,3)*(21-least(item.position,20))) as score
  from recommendation_sets s join provider_instances i on i.id=s.instance_id and i.enabled
  left join evidence e on e.id=s.seed_id left join provider_connections c on c.id=s.connection_id and c.status='connected' and c.account_generation=s.account_generation
  cross join lateral unnest(s.items) with ordinality item(id,position)
  where (s.connection_id is null and e.id is not null or ${workId}::uuid is null and c.user_id=${userId} and ${config.enableTrakt}) group by item.id
 ), candidates as (
  select w.id,coalesce(m.genres,g.genres,a.genres,b.subjects,'{}'::text[]) as genres,coalesce(b.authors,'{}'::text[]) as authors,b.series_title as series,coalesce(p.score,0) as provider_score,case when ts.revision=${revision?.revision??''} then coalesce((ts.score-50)*ts.confidence/100*.6,0) else 0 end as taste_score
  from works w left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id left join reading_works b on b.id=w.id left join provider_matches p on p.id=w.id left join user_taste_scores ts on ts.user_id=${userId} and ts.work_id=w.id
  where (w.category=${category} or ${category}='reading' and w.kind in ('book','comic')) and (w.kind<>'book' or ${config.experimentalBooks}) and (w.kind<>'comic' or ${config.experimentalComics}) and w.kind in ('movie','show','game','album','book','comic') and (${kind}::text is null or w.kind=${kind})
  and (${genre}::text is null or ${genre}::text=any(coalesce(m.genres,g.genres,a.genres,b.subjects,'{}'::text[])))
  and not exists(select 1 from tracking_state t where t.media_id=w.id and t.user_id=${userId} and (t.watched or t.dropped or t.watchlist or t.collected or t.favourite))
  and not exists(select 1 from reading_progress r where r.work_id=w.id and r.user_id=${userId})
  and not exists(select 1 from ratings r where r.media_id=w.id and r.user_id=${userId} and r.value<2.5)
  and not exists(select 1 from game_playthroughs g where g.game_id=w.id and g.user_id=${userId} and g.status in ('completed','dropped','in-progress'))
  and not exists(select 1 from evidence e where e.id=w.id)
  and (not ${available} or exists(select 1 from availability av join provider_connections pc on pc.id=av.connection_id join provider_instances pi on pi.id=pc.instance_id where av.media_id=w.id and av.user_id=${userId} and av.state='available' and pc.status='connected' and pi.enabled))
  and (m.release_date is null or m.release_date<=current_date) and (g.release_date is null or g.release_date<=current_date) and (a.release_date is null or a.release_date<=current_date) and (b.release_date is null or b.release_date<=current_date)
  order by coalesce(p.score,0)+case when ts.revision=${revision?.revision??''} then coalesce((ts.score-50)*ts.confidence/100*.6,0) else 0 end desc,w.id limit 2000
 ), scored as (
  select c.id,c.provider_score+c.taste_score+least(20,coalesce((select sum(e.weight*2) from evidence e where c.authors&&e.authors or c.series is not null and c.series=e.series),0))+least(30,coalesce((select sum(e.weight*(select count(*) from unnest(c.genres) genre where genre=any(e.genres))) from evidence e where c.genres&&e.genres),0))-3*(select count(*) from unnest(c.genres) genre where genre=any(${sql.array(negative,'TEXT')}::text[])) as score from candidates c
 ), selected as(select * from scored where score>0), totals as(select count(*)::int as total from selected)
 select total,coalesce((select jsonb_agg(row_to_json(p)) from(select id,score from selected order by score desc,case when ${feature}='row' then md5(${orderSeed}||coalesce(${genre}::text,${workId}::text,'')||id::text) else id::text end,id limit ${PAGE_SIZE} offset (least(${requested},greatest(1,ceil(total::numeric/${PAGE_SIZE})::int))-1)*${PAGE_SIZE})p),'[]'::jsonb) as candidates from totals`;
 const candidates=result.candidates as {id:string;score:number}[];
 return {...pagination(result.total,requested),total:result.total,title:workId&&positive[0]?relatedRowTitle(positive[0].title,genreReason(Number(positive[0].consumed),Number(positive[0].positive)),orderSeed):genre?genreRowTitle(category,genre,kind??undefined,reason,orderSeed):recommendationRowTitle(category,orderSeed),items:await workCards(userId,userId,candidates.map(item=>item.id))};
}
