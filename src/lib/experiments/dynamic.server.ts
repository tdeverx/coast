import * as v from 'valibot';
import {getSql} from '$lib/server/db';
import {getConfig} from '$lib/server/config';
import {genreRowTitle,relatedRowTitle,popularRowTitle,recommendationRowTitle,type DynamicMedium,type DynamicKind} from './row-titles';
import {genreReason,rankRows,type GenreReason} from './row-ranking';
import {interestWorks} from './interests.server';
export type DynamicRow={key:string;title:string;category:DynamicMedium}&({surface:'popular'}|{surface:'recommendations'}|{surface:'genre';genre:string;kind:DynamicKind;reason:GenreReason}|{surface:'seed';workId:string});
/** Definitions use bounded personal evidence. Card pages remain separate lazy requests. */
export async function dynamicFeed(userId:string,url:URL){
 const config=await getConfig();
 const offset=v.parse(v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(10000)),Number(url.searchParams.get('offset')??0));
 const limit=v.parse(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(3)),Number(url.searchParams.get('limit')??3));
 const seed=url.searchParams.has('seed')?v.parse(v.pipe(v.string(),v.minLength(1),v.maxLength(64),v.regex(/^[a-zA-Z0-9-]+$/)),url.searchParams.get('seed')):`${userId}:${new Date().toISOString().slice(0,10)}`;
 const enabled=(category:DynamicMedium)=>category==='screen'||category==='music'&&config.experimentalMusic||category==='game'&&config.experimentalGaming;
 const interests=(await interestWorks(userId)).filter(work=>enabled(work.category));
 const genres=new Map<string,{category:DynamicMedium;genre:string;score:number;consumed:number;positive:number}>();
 const definitions:(DynamicRow&{weight:number})[]=[];
 for(const work of interests){
  const recency=Date.now()-new Date(work.updated).getTime()<30*86400000?1.3:1;
  for(const genre of new Set(work.genres)){
   if(!genre.trim()||genre.length>100)continue;
   const key=`${work.category}:${genre}`;
   const entry=genres.get(key)??{category:work.category,genre,score:0,consumed:0,positive:0};
   entry.score+=work.weight*recency;entry.consumed+=Number(work.consumed&&work.weight>0);entry.positive+=Number(work.positive&&work.weight>0);genres.set(key,entry);
  }
  if(work.weight>0&&work.genres.length)definitions.push({key:`seed:${work.id}`,surface:'seed',category:work.category,workId:work.id,title:relatedRowTitle(work.title,genreReason(Number(work.consumed),Number(work.positive)),seed),weight:Math.min(5,work.weight)*recency*.25});
 }
 function addGenre(category:DynamicMedium,genre:string,weight:number,reason:GenreReason){
  const kinds:DynamicKind[]=category==='screen'?['movie','show']:category==='game'?['game']:['album'];
  for(const kind of kinds)definitions.push({key:`${category}:${genre}:${kind}`,surface:'genre',category,genre,kind,reason,title:genreRowTitle(category,genre,kind,reason,seed),weight:weight/kinds.length});
 }
 for(const entry of genres.values())if(entry.score>0)addGenre(entry.category,entry.genre,Math.min(12,entry.score),genreReason(entry.consumed,entry.positive));
 // Exploration must share an established interest; never choose a random disliked genre.
 for(const category of ['screen','game','music'] as const){
  if(!enabled(category))continue;
  if(interests.some(work=>work.category===category&&work.weight>0))definitions.push({key:`recommendations:${category}`,surface:'recommendations',category,title:recommendationRowTitle(category,seed),weight:3});
  const liked=[...genres.values()].filter(g=>g.category===category&&g.score>=3).sort((a,b)=>b.score-a.score).slice(0,5).map(g=>g.genre);
  if(liked.length){
   const db=getSql();
   const adjacent=await db<{genre:string}[]>`with candidates as(select coalesce(m.genres,g.genres,a.genres,'{}'::text[]) as genres from works w left join media m on m.id=w.id left join games g on g.id=w.id left join music_works a on a.id=w.id where w.category=${category} and w.kind in ('movie','show','game','album') and coalesce(m.genres,g.genres,a.genres,'{}'::text[]) && ${db.array(liked,'TEXT')}::text[] order by w.id limit 2000) select genre from candidates cross join lateral unnest(genres) genre where length(trim(genre)) between 1 and 100 group by genre order by count(*) desc,genre limit 30`;
   for(const {genre} of adjacent.filter(g=>!genres.has(`${category}:${g.genre}`)).slice(0,2))addGenre(category,genre,.35,'explore');
  }
  if(interests.some(work=>work.category===category&&work.weight>0))definitions.push({key:`popular:${category}`,surface:'popular',category,title:popularRowTitle(category,seed),weight:3});
 }
 const ordered=rankRows(definitions,seed);
 return {rows:ordered.slice(offset,offset+limit).map(({weight,...row})=>row),nextOffset:ordered.length>offset+limit?offset+limit:null};
}
