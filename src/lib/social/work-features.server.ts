import {getSql} from '#lib/server/db/index.js';
import {trackReadQuery} from '#lib/server/db/read-cancellation.js';
import {sourceOrder,type MetadataPolicy} from '#lib/catalogue/metadata/resolve.js';
import type {ReadingCatalogueFacts} from '#lib/reading/model.js';
import {namedFeatures,tasteDimensions,type TasteFeature,type TasteFeatures} from './taste-profile';
type ScreenFacts = {studios?:{name:string}[];networks?:{name:string}[];originalLanguage?:string;countries?:string[]};
type ScreenTasteSnapshot = {genres:string[]|null;facts:ScreenFacts|null};
const languageNames=new Intl.DisplayNames('en',{type:'language'});
const countryNames=new Intl.DisplayNames('en',{type:'region'});
/** Read existing metadata in a bounded batch; never fetch providers from a page request. */
export async function workTasteFeatures(ids:string[],policy?:MetadataPolicy):Promise<Map<string,TasteFeatures>>{
 if(!ids.length)return new Map();
 const sql=getSql();
 const sources=sql.array([...sourceOrder(policy,'details')],'TEXT');
 const rows=await trackReadQuery(()=>sql<{id:string;genres:string[];artists:string[];developers:string[];publishers:string[];authors:string[];series:string|null;features:TasteFeatures[];
  screen:ScreenTasteSnapshot[];overrideGenres:string[]|null;readingFacts:ReadingCatalogueFacts|null}[]>`
 select w.id,coalesce(b.authors,'{}'::text[]) as authors,b.series_title as series,
 coalesce(m.genres,nullif(g.genres,'{}'::text[]),pg.genres,a.genres,b.subjects,'{}'::text[]) as genres,
 coalesce(a.artist_names,'{}'::text[]) as artists,
 o.genres as "overrideGenres",coalesce(screen.snapshots,'[]'::jsonb) as screen,b.catalogue_facts as "readingFacts",
 coalesce(nullif(g.developers,'{}'::text[]),pg.developers,'{}'::text[]) as developers,coalesce(nullif(g.publishers,'{}'::text[]),pg.publishers,'{}'::text[]) as publishers,
 coalesce((select jsonb_agg(f.features order by (f.work_id=w.id) desc,f.updated_at desc,f.provider)
   from work_features f where f.work_id in (w.id,v.parent_id)), '[]'::jsonb) as features
 from works w left join media m on m.id=w.id left join metadata_overrides o on o.media_id=m.id
 left join lateral (
   select jsonb_agg(jsonb_build_object('genres',ms.genres,'facts',ms.raw->'facts')
     order by array_position(${sources}::text[],ms.provider)) as snapshots
   from (select distinct on (provider) provider, genres, raw from metadata_snapshots
     where media_id=m.id and provider=any(${sources}::text[]) and (cardinality(genres)>0 or raw?'facts')
     order by provider,updated_at desc,id) ms
 ) screen on true
 left join games g on g.id=w.id left join game_variants v on v.game_id=w.id left join games pg on pg.id=v.parent_id
 left join music_works a on a.id=w.id left join reading_works b on b.id=w.id
 where w.id=any(${sql.array(ids,'UUID')}::uuid[])`);
 return new Map(rows.map(row=>{
  const screenFacts=row.screen.flatMap(snapshot=>snapshot.facts?[snapshot.facts]:[]);
  const languageCodes=[...screenFacts.map(facts=>facts.originalLanguage??''),...(row.readingFacts?.openLibrary?.languages??[])];
  const genres=row.overrideGenres??row.screen.find(snapshot=>snapshot.genres?.length)?.genres??row.genres;
  const catalogue: TasteFeatures = {
   genres:namedFeatures(genres),writers:namedFeatures(row.authors),
   franchises:namedFeatures(row.series?[row.series]:[]),artists:namedFeatures(row.artists),
   developers:namedFeatures(row.developers),
   publishers:namedFeatures([...row.publishers,...(row.readingFacts?.openLibrary?.editionSample??[]).flatMap(edition=>edition.publishers??[])]),
   illustrators:namedFeatures((row.readingFacts?.comicVine?.credits??[])
    .filter(person=>/artist|illustrat|pencil|inker|colour|color/i.test(person.role)).map(person=>person.name)),
   studios:namedFeatures(screenFacts.flatMap(facts=>facts.studios??[]).map(studio=>studio.name)),
   networks:namedFeatures(screenFacts.flatMap(facts=>facts.networks??[]).map(network=>network.name)),
   languages:namedFeatures(languageCodes.filter(code=>/^[a-z]{2,3}$/i.test(code)).map(code=>languageNames.of(code)??code)),
   countries:namedFeatures(screenFacts.flatMap(facts=>facts.countries??[]).filter(code=>/^[a-z]{2}$/i.test(code)).map(code=>countryNames.of(code.toUpperCase())??code)),
  };
  const features: TasteFeatures = {};
  for(const dimension of tasteDimensions){
   const byId=new Map<string,TasteFeature>();
   // Core genre policy decides screen genres. Other dimensions combine distinct provider evidence.
   const lists=dimension==='genres'&&catalogue.genres?.length?[catalogue.genres]:[catalogue[dimension]??[],...row.features.map(feature=>feature[dimension]??[])];
   for(const list of lists)for(const feature of list)if(!byId.has(feature.id)&&byId.size<100)byId.set(feature.id,feature);
   if(byId.size)features[dimension]=[...byId.values()];
  }
  return [row.id,features];
 }));
}
