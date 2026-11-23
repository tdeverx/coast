import {getSql} from '#lib/server/db/index.js';
import {trackReadQuery} from '#lib/server/db/read-cancellation.js';
import {sourceOrder,type MetadataPolicy} from '#lib/catalogue/metadata/resolve.js';
import type {CatalogueFacts,CastMember} from '#lib/providers/contracts.js';
import {tmdbCastFeatures,tmdbCrewFeatures} from '#lib/providers/tmdb/taste-credits.js';
import type {ReadingCatalogueFacts} from '#lib/reading/model.js';
import {mediumForTasteKind,namedFeatures,tasteDimensionsByMedium,type TasteDimension,type TasteFeature,type TasteFeatures} from './taste-profile';
import {hasAudienceEvidence,type TasteAudienceRating} from './taste-rating-model';

type ScreenTasteSnapshot = {provider:string;genres:string[]|null;facts:CatalogueFacts|null;cast:Pick<CastMember,'id'|'name'>[]|null};
const languageNames=new Intl.DisplayNames('en',{type:'language'});
const countryNames=new Intl.DisplayNames('en',{type:'region'});
const unknownCertificates=['','NR','UR','UNRATED','NOT RATED','UNCLASSIFIED','N/A','NA','UNKNOWN','TBC','TBD','-'];
// A Jellyfin credit's stored role can be a character name. TMDB stores typed cast and crew.
function screenPeople(snapshots:ScreenTasteSnapshot[]){
 const tmdb=snapshots.find(snapshot=>snapshot.provider==='tmdb');
 const result=tmdbCrewFeatures(tmdb?.facts?.credits);
 if(Array.isArray(tmdb?.cast))result.cast=tmdbCastFeatures(tmdb.cast);
 return result;
}

/** Read existing metadata in a bounded batch; never fetch providers from a page request. */
export async function workTasteFeatures(ids:string[],policy?:MetadataPolicy,audienceRatings?:Map<string,TasteAudienceRating>,region?:string,readerId?:string,includeCreators=false):Promise<Map<string,TasteFeatures & {creators?:TasteFeature[]}>>{
 if(!ids.length)return new Map();
 const sql=getSql();
 const detailsSources=sql.array([...sourceOrder(policy,'details')],'TEXT');
 const releaseSources=sql.array([...sourceOrder(policy,'release')],'TEXT');
 const rows=await trackReadQuery(()=>sql<{
  id:string;kind:string;genres:string[];subjects:string[];artistNames:string[];artists:TasteFeature[];releaseYear:number|null;
  developers:string[];publishers:string[];authors:string[];series:string|null;features:TasteFeatures[];
  screen:ScreenTasteSnapshot[];overrideGenres:string[]|null;readingFacts:ReadingCatalogueFacts|null;gameAudience:TasteAudienceRating|null;certificate:string|null;editionIds:string[]|null;
 }[]>`
 select w.id,w.kind,coalesce(b.authors,'{}'::text[]) as authors,b.series_title as series,
 coalesce(m.genres,nullif(g.genres,'{}'::text[]),pg.genres,a.genres,'{}'::text[]) as genres,coalesce(b.subjects,'{}'::text[]) as subjects,
 coalesce(a.artist_names,'{}'::text[]) as "artistNames",
 case when a.kind='artist' then jsonb_build_array(jsonb_build_object('id','artist:'||a.id,'name',a.title))
  when a.id is not null then coalesce((
   select jsonb_agg(jsonb_build_object('id','artist:'||c.id,'name',c.title) order by c.id)
   from (select distinct artist.id,artist.title from music_credits credit join music_works artist on artist.id=credit.artist_id and artist.kind='artist'
    where credit.work_id=w.id and credit.role in ('artist','album-artist') order by artist.id limit 100) c
  ),'[]'::jsonb) else '[]'::jsonb end as artists,
 case when w.kind<>'artist' then coalesce(extract(year from coalesce(o.release_date,release.release_date,m.release_date,
  g.release_date,pg.release_date,a.release_date,b.release_date))::int,m.year,a.year,b.published_year) end as "releaseYear",
 o.genres as "overrideGenres",coalesce(screen.snapshots,'[]'::jsonb) as screen,b.catalogue_facts as "readingFacts",
 ${readerId ? sql`case when b.id is not null then (
   select array_agg(distinct edition.metadata->>'openLibraryEditionId')
   from reading_sessions s join provider_connections c on c.id=s.connection_id and c.user_id=s.user_id
    and c.account_generation=s.account_generation and c.status='connected'
   join provider_instances instance on instance.id=c.instance_id and instance.enabled
   join work_editions edition on edition.work_id=s.work_id and edition.instance_id=c.instance_id
    and edition.external_id=s.external_id and edition.metadata->>'version'=s.edition
   where s.user_id=${readerId} and s.work_id=b.id and s.share_id is null and s.location is not null
    and edition.metadata ? 'openLibraryEditionId' and coalesce(edition.metadata->>'identityConflict','false')='false'
  ) end` : sql`null`} as "editionIds",
 ${region ? sql`coalesce(o.certificate, certificate.value)` : sql`null`} as certificate,
 case when ${audienceRatings!==undefined} then g.catalogue_facts->'audience' end as "gameAudience",
 coalesce(nullif(g.developers,'{}'::text[]),pg.developers,'{}'::text[]) as developers,coalesce(nullif(g.publishers,'{}'::text[]),pg.publishers,'{}'::text[]) as publishers,
 coalesce(saved.features,'[]'::jsonb) as features
 from works w left join media m on m.id=w.id left join metadata_overrides o on o.media_id=m.id
 left join games g on g.id=w.id left join game_variants v on v.game_id=w.id left join games pg on pg.id=v.parent_id
 left join lateral (
  select jsonb_agg(f.features order by (f.work_id=w.id) desc,f.updated_at desc,f.provider) as features,
   bool_or(f.provider='tmdb' and f.features->'cast'->0 is not null) as has_cast
  from work_features f where f.work_id in (w.id,v.parent_id)
 ) saved on true
 left join lateral (
   select jsonb_agg(jsonb_build_object('provider',ms.provider,'genres',ms.genres,'facts',ms.raw->'facts',
    'cast',case when ms.provider='tmdb' and not coalesce(saved.has_cast,false) then ms.raw->'cast' end)
    order by array_position(${detailsSources}::text[],ms.provider)) as snapshots
   from (select distinct on(provider) provider,genres,raw from metadata_snapshots where media_id=m.id
    and provider=any(${detailsSources}::text[]) and (cardinality(genres)>0 or raw ?| array['facts','cast'])
    order by provider,updated_at desc,id) ms
 ) screen on true
 ${region ? sql`left join lateral (
   select ms.certificate as value from metadata_snapshots ms where ms.media_id=m.id and ms.region=${region}
    and ms.provider=any(${detailsSources}::text[]) and ms.certificate is not null
    and upper(btrim(ms.certificate)) <> all(${sql.array(unknownCertificates,'TEXT')}::text[])
   order by array_position(${detailsSources}::text[],ms.provider),ms.updated_at desc,ms.id limit 1
 ) certificate on w.kind in ('movie','show')` : sql``}
 left join lateral (
   select ms.release_date from metadata_snapshots ms where ms.media_id=m.id and ms.release_date is not null
    and ms.provider=any(${releaseSources}::text[])
   order by array_position(${releaseSources}::text[],ms.provider),ms.updated_at desc,ms.id limit 1
 ) release on true
 left join music_works a on a.id=w.id left join reading_works b on b.id=w.id
 where w.id=any(${sql.array(ids,'UUID')}::uuid[])`);
 return new Map(rows.map(row=>{
  const screenFacts=row.screen.flatMap(snapshot=>snapshot.facts?[snapshot.facts]:[]);
  if(audienceRatings){
   const audience=screenFacts.find(facts=>hasAudienceEvidence(facts.audience))?.audience??row.gameAudience;
   if(hasAudienceEvidence(audience))audienceRatings.set(row.id,audience);
  }
  const reading=row.readingFacts;
  const editions=reading?.openLibrary?.editionSample??[];
  const consumed=editions.filter(edition=>row.editionIds?.includes(edition.id));
  function readingLabels(field:'languages'|'publishers'){
   const exact=consumed.flatMap(edition=>edition[field]??[]);
   if(exact.length)return exact;
   const all=new Set([...(reading?.openLibrary?.[field]??[]),...editions.flatMap(edition=>edition[field]??[])]);
   return all.size===1 && (reading?.openLibrary?.[field]?.length||reading?.openLibrary?.editionCount===1)?[...all]:[];
  }
  const languageCodes=[...screenFacts.map(facts=>facts.originalLanguage??''),...readingLabels('languages')];
  const genres=row.overrideGenres??row.screen.find(snapshot=>snapshot.genres?.length)?.genres??row.genres;
  const artists=[...row.artists];
  if(row.kind!=='artist'&&row.artistNames.length){
   const knownNames=new Set(artists.map(artist=>artist.name.trim().toLocaleLowerCase('en-US')));
   for(const artist of namedFeatures(row.artistNames)){
    if(!knownNames.has(artist.id))artists.push({id:'artist-name:'+artist.id,name:artist.name});
   }
  }
  const people=screenPeople(row.screen);
  const certificate=row.certificate?.trim().toUpperCase();
  const catalogue:TasteFeatures = {
   ...people,genres:namedFeatures(genres),tags:namedFeatures([...row.subjects,...reading?.comicVine?.subjects??[]]),
   themes:namedFeatures(reading?.comicVine?.concepts??[]),writers:[...(people.writers??[]),...namedFeatures(row.authors)],
   franchises:namedFeatures(row.series?[row.series]:[]),artists,
   decades:row.releaseYear&&row.releaseYear>0?namedFeatures([Math.floor(row.releaseYear/10)*10+'s']):[],
   developers:namedFeatures(row.developers),
   publishers:namedFeatures([...row.publishers,...readingLabels('publishers'),
    ...reading?.comicVine?.publisher?[reading.comicVine.publisher]:[]]),
   illustrators:namedFeatures((reading?.comicVine?.credits??[])
    .filter(person=>/artist|illustrat|pencil|inker|colour|color/i.test(person.role)).map(person=>person.name)),
   studios:namedFeatures(screenFacts.flatMap(facts=>facts.studios??[]).map(studio=>studio.name)),
   networks:namedFeatures(screenFacts.flatMap(facts=>facts.networks??[]).map(network=>network.name)),
   languages:namedFeatures(languageCodes.filter(code=>/^[a-z]{2,3}$/i.test(code)).map(code=>languageNames.of(code)??code)),
   countries:namedFeatures(screenFacts.flatMap(facts=>facts.countries??[]).filter(code=>/^[a-z]{2}$/i.test(code)).map(code=>countryNames.of(code.toUpperCase())??code)),
  };
  const features:TasteFeatures & {creators?:TasteFeature[]}={};
  if (includeCreators && row.kind === 'show') {
   const creators = new Map<string,TasteFeature>();
   const tmdb = row.screen.find(source => source.provider === 'tmdb');
   for (const credit of Array.isArray(tmdb?.facts?.credits) ? tmdb.facts.credits : []) {
    if (credit?.role === 'Creator' && /^\d+$/.test(credit.id) && typeof credit.name==='string' && credit.name.trim())
     creators.set(credit.id, {id:'tmdb:'+credit.id, name:credit.name.trim()});
   }
   if (creators.size) features.creators=[...creators.values()];
  }
  const medium=mediumForTasteKind(row.kind);
  for(const dimension of medium?tasteDimensionsByMedium[medium]:[]){
   if(dimension==='ageRatings'){
    if(region && (row.kind==='movie'||row.kind==='show') && certificate && !unknownCertificates.includes(certificate))
     features.ageRatings=[{id:`${region}:${certificate}`,name:certificate}];
    continue;
   }
   const byId=new Map<string,TasteFeature>();
   // Core genre policy decides screen genres. Other dimensions combine distinct provider evidence.
   const editionSpecific=!!reading?.openLibrary&&(dimension==='publishers'||dimension==='languages');
   const resolved=editionSpecific||dimension==='genres'&&(row.overrideGenres!==null||catalogue.genres?.length);
   const lists=resolved?[catalogue[dimension]??[]]:[catalogue[dimension]??[],...row.features.map(feature=>feature[dimension]??[])];
   for(const list of lists)for(const feature of list)if(!byId.has(feature.id)&&byId.size<100)byId.set(feature.id,feature);
   if(byId.size)features[dimension]=[...byId.values()];
  }
  if((medium==='book'||medium==='comic')&&features.tags?.length&&features.genres?.length){
   // Older imports saved every subject as both a tag and a genre.
   const subjects=new Set(features.tags.map(tag=>tag.name.trim().toLocaleLowerCase('en-US')));
   features.genres=features.genres.filter(genre=>!subjects.has(genre.name.trim().toLocaleLowerCase('en-US')));
   if(!features.genres.length)delete features.genres;
  }
  return [row.id,features];
 }));
}

/** Record each guest or collaborator once per canonical work, from the children actually rated. */
export async function childTasteCredits(
 works:readonly {id:string;kind:string;childRatings:{id:string;rating:number}[]|null}[],
 parents:Map<string,TasteFeatures>,policy?:MetadataPolicy,
){
 const result=new Map<string,{features:TasteFeatures;rating:number}[]>();
 const ratings=works.flatMap(work=>(work.childRatings??[]).map(child=>({work,child})));
 type ChildCredit={dimension:TasteDimension;feature:TasteFeature;values:number[]};
 const samples=new Map<string,Map<string,ChildCredit>>();
 for(let offset=0;offset<ratings.length;offset+=300){
  const batch=ratings.slice(offset,offset+300);
  const credits=await workTasteFeatures(batch.map(({child})=>child.id),policy);
  for(const {work,child} of batch){
   const facts=credits.get(child.id);
   if(!facts)continue;
   const dimensions=work.kind==='album'?['artists','writers','composers'] as const
    :['cast','directors','writers','composers','cinematographers'] as const;
   const parent=parents.get(work.id);
   const entries=samples.get(work.id)??new Map<string,ChildCredit>();
   samples.set(work.id,entries);
   for(const dimension of dimensions)for(const feature of facts[dimension]??[]){
    if(work.kind!=='album'&&!feature.id.startsWith('tmdb:')||dimension==='artists'&&!feature.id.startsWith('artist:'))continue;
    if(parent?.[dimension]?.some(person=>person.id===feature.id))continue;
    const key=dimension+':'+feature.id;
    const entry=entries.get(key)??{dimension,feature,values:[]};
    entry.values.push(child.rating);
    entries.set(key,entry);
   }
  }
 }
 for(const [id,entries] of samples){
  const groups=new Map<number,TasteFeatures>();
  for(const {dimension,feature,values} of entries.values()){
   values.sort((a,b)=>a-b);
   const rating=(values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2;
   const facts=groups.get(rating)??{};
   (facts[dimension]??=[]).push(feature);
   groups.set(rating,facts);
  }
  result.set(id,[...groups].map(([rating,features])=>({rating,features})));
 }
 return result;
}
