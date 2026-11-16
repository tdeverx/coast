import {categoryEnabled} from '#lib/experimental.js';
import { getFeatureConfig } from '#lib/server/features.js';
import * as v from 'valibot';
import {getSql} from '#lib/server/db/index.js';
import {AppError} from '#lib/server/security/errors.js';
import {browseRowTitle,genreRowTitle,relatedRowTitle,popularRowTitle,recommendationRowTitle} from './row-titles';
import {genreReason,rankRows} from './row-ranking';
import {interestWorks} from './interests.server';
import type {DynamicRow,DynamicMedium,DynamicKind,GenreReason} from './model';
import {browseSources,libraryKinds} from './browse-sources.server';
import {kindsByMedium,providerGenreKey,supportsProviderRow} from './row-catalog';
/** One immutable definition census per visit; card pages remain separate lazy requests. */
export async function dynamicFeed(userId:string,url:URL){
 const config=await getFeatureConfig(userId);
 if(!config.features.personalisation)throw new AppError(403,'Personalisation is turned off.','feature_disabled');
 const seed=url.searchParams.has('seed')?v.parse(v.pipe(v.string(),v.minLength(1),v.maxLength(64),v.regex(/^[a-zA-Z0-9-]+$/)),url.searchParams.get('seed')):`${userId}:${new Date().toISOString().slice(0,10)}`;
 const selected=v.parse(v.optional(v.picklist(['screen','music','game','reading'])),url.searchParams.get('category')??undefined);
 const enabled=(category:DynamicMedium)=>(!selected||category===selected)&&categoryEnabled(config,category);
 const interests=(await interestWorks(userId,selected)).filter(work=>enabled(work.category)&&(work.kind!=='book'||config.experimentalBooks)&&(work.kind!=='comic'||config.experimentalComics));
 const positives = new Set(interests.filter(work=>work.weight>0).map(work=>work.category));
 const [sources,owned] = positives.size ? await Promise.all([browseSources(selected,config.enableTrakt),libraryKinds(userId)]) : [null,new Set<DynamicKind>()];
 const genres=new Map<string,{category:DynamicMedium;genre:string;score:number;consumed:number;positive:number}>();
 const definitions:(DynamicRow&{weight:number})[]=[];
 function addDefinition(row:DynamicRow&{weight:number}){
  if(definitions.length>=10000)throw new AppError(413,'This feed has too many row definitions. Narrow your interests and try again.','feed_definition_limit');
  definitions.push(row);
 }
 for(const work of interests){
  const recency=Date.now()-new Date(work.updated).getTime()<30*86400000?1.3:1;
  for(const genre of new Set(work.genres)){
   if(!genre.trim()||genre.length>100)continue;
   const key=`${work.category}:${genre}`;
   const entry=genres.get(key)??{category:work.category,genre,score:0,consumed:0,positive:0};
   entry.score+=work.weight*recency;entry.consumed+=Number(work.consumed&&work.weight>0);entry.positive+=Number(work.positive&&work.weight>0);genres.set(key,entry);
  }
  if(work.weight>0&&(work.genres.length||work.category==='reading'))addDefinition({key:`seed:${work.id}`,surface:'seed',category:work.category,workId:work.id,title:relatedRowTitle(work.title,genreReason(Number(work.consumed),Number(work.positive)),seed),weight:Math.min(5,work.weight)*recency*.25});
 }
 const kindsFor = (category:DynamicMedium) => kindsByMedium[category].filter(kind=>(kind!=='book'&&kind!=='comic')||categoryEnabled(config,kind));
 function addGenre(category:DynamicMedium,genre:string,weight:number,reason:GenreReason){
  const kinds=kindsFor(category);
  for(const kind of kinds)addDefinition({key:`${category}:${genre}:${kind}`,surface:'genre',category,genre,kind,reason,title:genreRowTitle(category,genre,kind,reason,seed),weight:weight/kinds.length});
 }
 for(const entry of genres.values())if(entry.score>0)addGenre(entry.category,entry.genre,Math.min(12,entry.score),genreReason(entry.consumed,entry.positive));
 // Exploration must share an established interest; never choose a random disliked genre.
 for(const category of ['screen','game','music','reading'] as const){
  if(!enabled(category))continue;
  const liked=[...genres.values()].filter(g=>g.category===category&&g.score>=3).sort((a,b)=>b.score-a.score).slice(0,5);
  if (positives.has(category)) {
   addDefinition({key:`recommendations:${category}`,surface:'recommendations',category,title:recommendationRowTitle(category,seed),weight:3});
   for (const kind of kindsFor(category)) {
    if (owned.has(kind)) {
     addDefinition({key:`recommendations:library:${kind}`,surface:'recommendations',category,kind,available:true,title:browseRowTitle(kind,'library'),weight:3});
     const favourite = liked[0];
     if (favourite) addDefinition({key:`genre:library:${kind}:${favourite.genre}`,surface:'genre',category,kind,
      genre:favourite.genre,reason:genreReason(favourite.consumed,favourite.positive),available:true,title:browseRowTitle(kind,'library',favourite.genre),weight:2});
    }
    const tags = [...new Set(liked.flatMap(entry=>providerGenreKey(entry.genre,kind)??[]))].slice(0,2);
    for (const variant of ['provider-genre','provider-rated','provider-upcoming'] as const) {
     for (const genre of variant==='provider-genre'?tags:tags.slice(0,1)) if (sources && supportsProviderRow(sources,kind,variant,genre))
      addDefinition({key:`browse:${variant}:${kind}:${genre}`,surface:'browse',category,kind,variant,genre,title:browseRowTitle(kind,variant,genre),weight:3});
    }
   }
  }
  if(liked.length){
   const db=getSql();
   const adjacent=await db<{genre:string}[]>`with candidates as(select coalesce(m.genres,g.genres,a.genres,b.subjects,'{}'::text[]) as genres from works w left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id left join reading_works b on b.id=w.id where (w.category=${category} or ${category}='reading' and w.kind in ('book','comic')) and (w.kind<>'book' or ${config.experimentalBooks}) and (w.kind<>'comic' or ${config.experimentalComics}) and w.kind in ('movie','show','game','album','book','comic') and coalesce(m.genres,g.genres,a.genres,b.subjects,'{}'::text[]) && ${db.array(liked.map(row=>row.genre),'TEXT')}::text[] order by w.id limit 2000) select genre from candidates cross join lateral unnest(genres) genre where length(trim(genre)) between 1 and 100 group by genre order by count(*) desc,genre limit 30`;
   for(const {genre} of adjacent.filter(g=>!genres.has(`${category}:${g.genre}`)).slice(0,2))addGenre(category,genre,.35,'explore');
  }
  if(config.features.social&&positives.has(category))addDefinition({key:`popular:${category}`,surface:'popular',category,title:popularRowTitle(category,seed),weight:3});
 }
 const ordered=rankRows(definitions,seed);
 return {rows:ordered.map(({weight,...row})=>row)};
}
