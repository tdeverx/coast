import {getSql} from '#lib/server/db/index.js';
import {assertJobLease} from '#lib/server/queue/execution.js';
import type {FeatureConfig} from '#lib/server/features.js';
import type {InterestWork} from '#lib/recommendations/interests.server.js';
import {scorerFromReference,tasteDimensions,type LifetimeTasteProfile,type TasteMedium,type TasteReference} from './taste-profile';
import {workTasteFeatures} from './work-features.server';

type WarmScore=ReturnType<ReturnType<typeof scorerFromReference>>;

/** The shortlist selects a bounded set to warm. The score itself always uses the published personal reference. */
export async function warmTasteScores(userId:string,region:string,config:FeatureConfig,evidence:InterestWork[],
  profiles:Map<TasteMedium,{profile:LifetimeTasteProfile;reference:TasteReference}>){
  const sql=getSql();
  const scoreable=[...profiles].filter(([,row])=>Object.keys(row.reference.dimensions).length>0||!!row.reference.selection);
  const candidateKinds=scoreable.map(([medium])=>medium==='music'?'album':medium);
  const probes=scoreable.flatMap(([medium,{profile}])=>tasteDimensions.flatMap(dimension=>{
   if(dimension==='ageRatings')return [];
   const selected=[];
   for(const [id,,value,samples] of profile.dimensions[dimension]??[]){
    if(value<=0)continue;
    if(dimension==='cast'&&samples<2)continue;
    selected.push({medium,features:{[dimension]:[{id}]}});
    if(selected.length===8)break;
   }
   return selected;
  }));
  const positive=evidence.filter(work=>work.weight>0),seedIds=positive.map(work=>work.id);
  const genreSeeds=positive.flatMap(work=>work.genres.map(genre=>({
   medium:work.category==='music'?'music':work.kind,genre,
  })));
  const candidates=candidateKinds.length?await sql<{id:string;medium:TasteMedium}[]>`with provider_ids as (
   select distinct unnest(s.items) as id from recommendation_sets s join provider_instances i on i.id=s.instance_id and i.enabled left join provider_connections c on c.id=s.connection_id and c.status='connected' and c.account_generation=s.account_generation
   where s.connection_id is null and s.seed_id=any(${sql.array(seedIds,'UUID')}::uuid[]) or c.user_id=${userId} and ${config.enableTrakt}
  ), feature_ids as (
   select distinct f.work_id as id from work_features f join works w on w.id=f.work_id
   where exists(select 1 from jsonb_to_recordset(${JSON.stringify(probes)}::text::jsonb) p(medium text,features jsonb)
    where f.features @> p.features and case when w.category='music' then 'music' else w.kind end=p.medium)
  ), genre_seeds as materialized (select distinct medium,genre from jsonb_to_recordset(${JSON.stringify(genreSeeds)}::text::jsonb) seed(medium text,genre text)), ranked as (
   select w.id,case when w.category='music' then 'music' else w.kind end as medium,
    row_number() over(partition by case when w.category='music' then 'music' else w.kind end order by (p.id is not null) desc,(fi.id is not null) desc,coalesce(m.release_date,g.release_date,a.release_date,b.release_date) desc nulls last,w.id) as rank
   from works w left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id left join reading_works b on b.id=w.id left join provider_ids p on p.id=w.id left join feature_ids fi on fi.id=w.id
   where w.kind=any(${sql.array(candidateKinds,'TEXT')}::text[])
   and coalesce(m.release_date,g.release_date,a.release_date,b.release_date,current_date)<=current_date
   and (p.id is not null or fi.id is not null or exists(select 1 from genre_seeds seed where seed.medium=case when w.category='music' then 'music' else w.kind end and seed.genre=any(coalesce(m.genres,g.genres,a.genres,b.subjects,'{}'::text[]))))
   and not w.id=any(${sql.array(evidence.map(work=>work.id),'UUID')}::uuid[])
   and not exists(select 1 from tracking_state t where t.user_id=${userId} and t.media_id=w.id and (t.watched or t.dropped or t.collected or t.watchlist or t.favourite))
  ) select id,medium from ranked where rank<=500`:[];
  const scorers=new Map(scoreable.map(([medium,{reference}])=>[medium,scorerFromReference(reference)]));
  const scores:(WarmScore & {workId:string})[]=[];
  for(let offset=0;offset<candidates.length;offset+=300){
   await assertJobLease(sql);
   const batch=candidates.slice(offset,offset+300);
   const features=await workTasteFeatures(batch.map(work=>work.id),config.metadataSource,undefined,region);
   for(const work of batch)scores.push({workId:work.id,...scorers.get(work.medium)!(features.get(work.id)??{})});
  }
  return scores;
}
