// Historical reader used by owned-copy benchmark comparisons and their regression fixtures.
import {sql as query} from 'drizzle-orm';
import {getDb} from '#lib/server/db/index.js';
import {requireFeature,type FeatureConfig} from '#lib/server/features.js';
import {AppError} from '#lib/server/security/errors.js';
import {maxTasteBatchSize} from '#lib/social/card-taste.js';
import {readableTasteProfileSql,shortlistScoreFormat,targetFeatures,type TasteScoreMode} from '#lib/social/taste-cache.server.js';
import {scorerFromReference,decodeTasteAffinities,tasteDimensionsByMedium,type TasteReference,type TasteAffinity,type SavedAffinity,type TasteDimension,type TasteMedium} from '#lib/social/taste-profile.js';
import {summarizeTasteSelection,type TasteSelection} from '#lib/social/taste-selection.js';
import {workTasteFeatures} from '#lib/social/work-features.server.js';

const tasteAffinityPageSize=25;

/** Read only the selected signal from the caller's saved profile. */
export async function personalTasteAffinities(userId: string, medium: TasteMedium, dimension: TasteDimension, page: number): Promise<{items:TasteAffinity[];pages:number}> {
 await requireFeature(userId,'personalisation');
 const dimensions:readonly TasteDimension[]=tasteDimensionsByMedium[medium];
 if(!dimensions.includes(dimension))return {items:[],pages:1};
 const offset=(page-1)*tasteAffinityPageSize;
 const [row]=await getDb().execute<{items:TasteAffinity[]|SavedAffinity[];total:number;selection: TasteSelection[TasteDimension] | null; genreNames: Record<string,string> | null}>(query`
   with saved as materialized (
     select case when profile->'choiceOnly' ? ${dimension}::text
       then coalesce(profile->'dimensions'->${dimension}::text,'[]'::jsonb) || (profile->'choiceOnly'->${dimension}::text)
       else coalesce(profile->'dimensions'->${dimension}::text,'[]'::jsonb) end as entries,
      scoring->'selection'->${dimension}::text as selection,
      case when scoring->'selection'->${dimension}::text is not null then (
        select jsonb_object_agg(entry->>0,entry->>1)
        from jsonb_array_elements(coalesce(profile->'dimensions'->'genres','[]'::jsonb)) entries(entry)
      ) end as "genreNames"
     from users u join user_taste_profiles p on p.user_id=u.id
     where u.id=${userId}::uuid and medium=${medium} and ${readableTasteProfileSql}
   )
   select jsonb_array_length(entries) as total, selection, "genreNames", coalesce((
     select jsonb_agg(entries->position::int order by position)
     from generate_series(${offset}::bigint,least(${offset+tasteAffinityPageSize-1}::bigint,jsonb_array_length(entries)-1)) position
   ),'[]'::jsonb) as items from saved`);
 const items=decodeTasteAffinities(row?.items??[]);
 const rules=row?.selection;
 if(rules)for(const affinity of items){
  if(!Object.hasOwn(rules,affinity.id))continue;
  affinity.viewingChoice=summarizeTasteSelection(rules[affinity.id],affinity.value,row.genreNames??{});
 }
 return {items,pages:Math.max(1,Math.ceil((row?.total??0)/tasteAffinityPageSize))};
}

export type TasteMatch = ReturnType<ReturnType<typeof scorerFromReference>>;
type Target=Parameters<typeof targetFeatures>[0]&{cached:TasteMatch|null};
type MatchGroup = {reference:TasteReference|null;targets:Target[];region:string};
function hasComparableFeatures(reference:TasteReference){return Object.keys(reference.dimensions).length>0||!!reference.selection;}

/** Fetch each required private reference once. Warm targets need only their published result. */
export async function titleTastes(userId:string,workIds:readonly string[],verifiedConfig?:FeatureConfig,mode:TasteScoreMode='published',inspect=false):Promise<Map<string,TasteMatch>> {
 const config=verifiedConfig??await requireFeature(userId,'personalisation');
 if(workIds.length>maxTasteBatchSize)throw new AppError(400,`Choose up to ${maxTasteBatchSize} titles.`);
 const result=new Map<string,TasteMatch>();
 if(!workIds.length)return result;
 const ids=[...new Set(workIds.map(id=>id.toLowerCase()))];
 const idArray=`{${ids.join(',')}}`; // Callers supply validated UUIDs or catalogue IDs.
 const groups=await getDb().execute<MatchGroup>(query`
  with roots as materialized (
   select w.id,w.kind,coalesce(e.show_id,s.show_id,album.parent_id,w.id) as root,
    case when w.category='music' then 'music' when w.kind in ('season','episode') then 'show' else w.kind end as medium,
    case when album.parent_id is not null then exists(
     select 1 from music_credits cr join music_works artist on artist.id=cr.artist_id and artist.kind='artist'
     where cr.work_id=w.id and cr.role in ('artist','album-artist'))
      or exists(select 1 from work_features f where f.work_id=w.id and
       (f.features->'tags'->0 is not null or f.features->'writers'->0 is not null
        or f.features->'composers'->0 is not null or f.features->'studios'->0 is not null))
    when coalesce(e.show_id,s.show_id) is not null then exists(select 1 from work_features f where f.work_id=w.id and f.provider='tmdb'
     and (f.features->'cast'->0 is not null or f.features->'directors'->0 is not null or f.features->'writers'->0 is not null
      or f.features->'composers'->0 is not null or f.features->'cinematographers'->0 is not null))
     or exists(select 1 from metadata_snapshots snap where snap.media_id=w.id and snap.provider='tmdb'
      and (snap.raw#>'{cast,0}' is not null or snap.raw#>'{facts,credits,0}' is not null))
    else false end as precise
   from works w left join episodes e on e.media_id=w.id left join seasons s on s.media_id=w.id
   left join lateral (
    select r.parent_id from media_relationships r join works parent on parent.id=r.parent_id and parent.kind='album'
    where w.kind='track' and r.child_id=w.id and r.kind='contains' order by r.position,r.parent_id limit 1
   ) album on true
   where w.id=any(${idArray}::uuid[])
  )
  select batch.targets,case when batch.cold then p.scoring end as reference,coalesce(u.settings->>'region','GB') as region
  from users u join user_taste_profiles p on p.user_id=u.id
  join lateral (
   select jsonb_agg(jsonb_build_object('id',r.id,'root',r.root,'kind',r.kind,'precise',r.precise,'cached',ts.breakdown)) as targets,
    bool_or(ts.work_id is null) as cold
   from roots r left join user_taste_scores ts on ${mode==='published'&&!inspect} and not r.precise and split_part(p.revision,':',3)=${shortlistScoreFormat} and ts.user_id=p.user_id and ts.work_id=r.root and ts.revision=p.revision
   where r.medium=p.medium
  ) batch on batch.targets is not null
  where u.id=${userId}::uuid and ${readableTasteProfileSql}`);
 const missing=new Set<string>();
 for(const {targets,reference} of groups){
  const empty=reference?.works&&!hasComparableFeatures(reference)?scorerFromReference(reference,inspect)({}):null;
  for(const target of targets){
   const match=target.cached??empty;
   if(match)result.set(target.id,match);
   else if(reference?.works){missing.add(target.root);if(target.precise)missing.add(target.id);}
  }
 }
 if(missing.size){
  const certificationRegion=groups.find(group=>group.reference?.dimensions.ageRatings)?.region;
  const features=await workTasteFeatures([...missing],config.metadataSource,undefined,certificationRegion);
  for(const group of groups){
   if(!group.reference?.works)continue;
   const score=scorerFromReference(group.reference,inspect);
   const scored=new Map<string,TasteMatch>();
   for(const t of group.targets){
    if(result.has(t.id))continue;
    const key=t.precise?t.id:t.root;
    const match=scored.get(key)??score(targetFeatures(t,features));
    scored.set(key,match);
    result.set(t.id,match);
   }
  }
 }
 if(mode==='recalculate'&&config.features.social){
  const scoreable=[...result].flatMap(([id,match])=>match.score===null?[]:[id]);
  if(scoreable.length){
   const {visibleFriendTaste}=await import('./incumbent-friend-taste');
   const friends=await visibleFriendTaste(userId,scoreable);
   for(const [id,signal] of friends){
    const match=result.get(id);
    if(match?.score==null||!signal.watched)continue;
    const score=Math.max(0,Math.min(100,match.score+signal.points));
    result.set(id,{...match,score,...(match.breakdown?{breakdown:{...match.breakdown,friends:{...signal,points:score-match.score}}}:{})});
   }
  }
 }
 return new Map(workIds.flatMap(id=>{const match=result.get(id.toLowerCase());return match?[[id,match] as const]:[];}));
}

export async function titleTaste(userId:string,workId:string,mode?:TasteScoreMode){
 return (await titleTastes(userId,[workId],undefined,mode,mode==='recalculate')).get(workId)??null;
}
