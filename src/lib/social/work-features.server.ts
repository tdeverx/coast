import {getSql} from '#lib/server/db/index.js';
import {trackReadQuery} from '#lib/server/db/read-cancellation.js';
import {sourceOrder,type MetadataPolicy} from '#lib/catalogue/metadata/resolve.js';
import type {CatalogueFacts,CastMember} from '#lib/providers/contracts.js';
import {tmdbCastFeatures,tmdbCrewFeatures} from '#lib/providers/tmdb/taste-credits.js';
import type {ReadingCatalogueFacts} from '#lib/reading/model.js';
import {namedFeatures,tasteDimensions,type TasteFeature,type TasteFeatures} from './taste-profile';

type ScreenTasteSnapshot = {provider:string;genres:string[]|null;facts:CatalogueFacts|null;cast:Pick<CastMember,'id'|'name'>[]|null};
const languageNames=new Intl.DisplayNames('en',{type:'language'});
const countryNames=new Intl.DisplayNames('en',{type:'region'});
// A Jellyfin credit's stored role can be a character name. TMDB stores typed cast and crew.
function screenPeople(snapshots:ScreenTasteSnapshot[]){
 const tmdb=snapshots.find(snapshot=>snapshot.provider==='tmdb');
 const result=tmdbCrewFeatures(tmdb?.facts?.credits);
 if(Array.isArray(tmdb?.cast))result.cast=tmdbCastFeatures(tmdb.cast);
 return result;
}

/** Read existing metadata in a bounded batch; never fetch providers from a page request. */
export async function workTasteFeatures(ids:string[],policy?:MetadataPolicy):Promise<Map<string,TasteFeatures>>{
 if(!ids.length)return new Map();
 const sql=getSql();
 const detailsSources=sql.array([...sourceOrder(policy,'details')],'TEXT');
 const releaseSources=sql.array([...sourceOrder(policy,'release')],'TEXT');
 const rows=await trackReadQuery(()=>sql<{
  id:string;kind:string;genres:string[];subjects:string[];artistNames:string[];artists:TasteFeature[];releaseYear:number|null;
  developers:string[];publishers:string[];authors:string[];series:string|null;features:TasteFeatures[];
  screen:ScreenTasteSnapshot[];overrideGenres:string[]|null;readingFacts:ReadingCatalogueFacts|null;
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
 left join lateral (
   select ms.release_date from metadata_snapshots ms where ms.media_id=m.id and ms.release_date is not null
    and ms.provider=any(${releaseSources}::text[])
   order by array_position(${releaseSources}::text[],ms.provider),ms.updated_at desc,ms.id limit 1
 ) release on true
 left join music_works a on a.id=w.id left join reading_works b on b.id=w.id
 where w.id=any(${sql.array(ids,'UUID')}::uuid[])`);
 return new Map(rows.map(row=>{
  const screenFacts=row.screen.flatMap(snapshot=>snapshot.facts?[snapshot.facts]:[]);
  const languageCodes=[...screenFacts.map(facts=>facts.originalLanguage??''),...(row.readingFacts?.openLibrary?.languages??[])];
  const genres=row.overrideGenres??row.screen.find(snapshot=>snapshot.genres?.length)?.genres??row.genres;
  const artists=[...row.artists];
  if(row.kind!=='artist'&&row.artistNames.length){
   const knownNames=new Set(artists.map(artist=>artist.name.trim().toLocaleLowerCase('en-US')));
   for(const artist of namedFeatures(row.artistNames)){
    if(!knownNames.has(artist.id))artists.push({id:'artist-name:'+artist.id,name:artist.name});
   }
  }
  const people=screenPeople(row.screen);
  const catalogue:TasteFeatures = {
   ...people,genres:namedFeatures(genres),tags:namedFeatures(row.subjects),writers:[...(people.writers??[]),...namedFeatures(row.authors)],
   franchises:namedFeatures(row.series?[row.series]:[]),artists,
   decades:row.releaseYear&&row.releaseYear>0?namedFeatures([Math.floor(row.releaseYear/10)*10+'s']):[],
   developers:namedFeatures(row.developers),
   publishers:namedFeatures([...row.publishers,...(row.readingFacts?.openLibrary?.editionSample??[]).flatMap(edition=>edition.publishers??[])]),
   illustrators:namedFeatures((row.readingFacts?.comicVine?.credits??[])
    .filter(person=>/artist|illustrat|pencil|inker|colour|color/i.test(person.role)).map(person=>person.name)),
   studios:namedFeatures(screenFacts.flatMap(facts=>facts.studios??[]).map(studio=>studio.name)),
   networks:namedFeatures(screenFacts.flatMap(facts=>facts.networks??[]).map(network=>network.name)),
   languages:namedFeatures(languageCodes.filter(code=>/^[a-z]{2,3}$/i.test(code)).map(code=>languageNames.of(code)??code)),
   countries:namedFeatures(screenFacts.flatMap(facts=>facts.countries??[]).filter(code=>/^[a-z]{2}$/i.test(code)).map(code=>countryNames.of(code.toUpperCase())??code)),
  };
  const features:TasteFeatures={};
  for(const dimension of tasteDimensions){
   const byId=new Map<string,TasteFeature>();
   // Core genre policy decides screen genres. Other dimensions combine distinct provider evidence.
   const lists=dimension==='genres'&&(row.overrideGenres!==null||catalogue.genres?.length)?[catalogue.genres??[]]:[catalogue[dimension]??[],...row.features.map(feature=>feature[dimension]??[])];
   for(const list of lists)for(const feature of list)if(!byId.has(feature.id)&&byId.size<100)byId.set(feature.id,feature);
   if(byId.size)features[dimension]=[...byId.values()];
  }
  // Older reading imports saved every library subject under both genres and tags.
  if((row.kind==='book'||row.kind==='comic')&&features.tags?.length&&features.genres?.length){
   const subjects=new Set(features.tags.map(tag=>tag.name.trim().toLocaleLowerCase('en-US')));
   features.genres=features.genres.filter(genre=>!subjects.has(genre.name.trim().toLocaleLowerCase('en-US')));
   if(!features.genres.length)delete features.genres;
  }
  return [row.id,features];
 }));
}
