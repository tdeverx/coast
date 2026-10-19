import {expect,test} from 'bun:test';
import {sql,and,eq,inArray} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import * as v from 'valibot';
import * as s from '../src/lib/server/db/schema';
import {resolveMetadata} from '../src/lib/catalogue/metadata/resolve';
import {publicWork} from '../src/lib/server/public-api/response';
import {readingCard} from '../src/lib/reading/presentation';

const compile=(source:string,deps:Record<string,unknown>,name:string)=>new Function(...Object.keys(deps),new Bun.Transpiler({loader:'ts'}).transformSync(source).replaceAll('export ','')+';return '+name)(...Object.values(deps));
const mediaSource=await Bun.file(new URL('../src/lib/server/queries/media.ts',import.meta.url)).text();
const mediaOwner=mediaSource.slice(mediaSource.indexOf('export async function screenWorkSummaries('),mediaSource.indexOf('export async function mediaViews('));
const id='00000000-0000-4000-8000-000000000001';
const groupBy=(rows:any[],key:(row:any)=>string)=>{const result=new Map<string,any[]>();for(const row of rows){const k=key(row);result.set(k,[...(result.get(k)??[]),row]);}return result;};

test('identity metadata retains original-title, viewer preference, locks and provider year policy without personal reads',async()=>{
 for(const [originalTitles,locked,alias,policy,title,year] of [
  [false,false,null,'local-first','Local',1998],[true,false,null,'local-first','Original local',1998],
  [true,false,'Viewer alias','local-first','Viewer alias',1998],[true,true,'Viewer alias','local-first','Local',1998],
  [false,false,null,'tmdb-only','TMDB',2010],[true,false,'','local-first','',1998],
 ] as const){
  const reads:unknown[]=[],tables=new Map<unknown,unknown[]>([
   [s.media,[{id,kind:'movie',title:'Fallback',originalTitle:'Fallback original',year:2000,releaseDate:null}]],
   [s.metadataSnapshots,[{mediaId:id,provider:'tmdb',updatedAt:new Date('2026-01-02'),title:'TMDB',originalTitle:'Original TMDB',releaseDate:'2010-01-01'},
    {mediaId:id,provider:'jellyfin',updatedAt:new Date('2026-01-01'),title:'Local',originalTitle:'Original local',releaseDate:'1998-01-01'}]],
   [s.metadataOverrides,[]],[s.metadataLocks,locked?[{mediaId:id,field:'title'}]:[]],
   [s.userMetadataPreferences,alias===null?[]:[{mediaId:id,title:alias}]],[s.users,[{originalTitles}]],
  ]);
  const getDb=()=>({select:()=>({from:(table:unknown)=>{expect(tables.has(table)).toBe(true);reads.push(table);return{where:async()=>tables.get(table)};}})});
  const read=compile(mediaOwner,{v,uuidSchema:v.pipe(v.string(),v.uuid()),PAGE_SIZE:60,getFeatureConfig:async()=>({features:{screen:true}}),getDb,s,sql,and,eq,inArray,groupBy,resolveMetadata,getConfig:async()=>({metadataSource:policy})},'screenWorkSummaries');
  expect(await read(id,[id],id)).toEqual([{id,kind:'movie',title,year}]);expect(reads).toHaveLength(6);
 }
});

test('summary metadata admission never starts disabled-screen or empty reads',async()=>{
 const read=compile(mediaOwner,{v,uuidSchema:v.pipe(v.string(),v.uuid()),PAGE_SIZE:60,getFeatureConfig:async()=>({features:{screen:false}}),getDb:()=>{throw Error('Unexpected database read');}},'screenWorkSummaries');
 expect(await read(id,[id],id)).toEqual([]);expect(await read(id,[],id)).toEqual([]);
});

test('summary batching keeps canonical identities, repeated order, game null year and reading attribution',async()=>{
 const source=await Bun.file(new URL('../src/lib/collection/query.server.ts',import.meta.url)).text(),owner=source.slice(source.indexOf('export async function workSummaries('),source.indexOf('export async function workCards('));
 const uuid=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),screen=Array.from({length:61},(_,i)=>({id:uuid(i+1),category:'screen'})),game={id:uuid(100),category:'game'},music={id:uuid(101),category:'music'},comic={id:uuid(102),category:'comic'};
 const identities=[...screen,game,music,comic],dialect=new PgDialect(),calls:number[]=[],aliasedKinds:string[][]=[];
 const data=new Map<unknown,any[]>([[s.works,identities],[s.musicWorks,[{...music,kind:'track',title:'Music',year:2005}]],
  [s.readingWorks,[{...comic,kind:'comic',title:'Comic',authors:[],publishedYear:2006,provider:'comic-vine',sourceUrl:'https://comicvine.gamespot.com/actual-shape/'}]]]);
 const db={select:()=>({from:(table:unknown)=>{let rows=data.get(table);expect(rows).toBeDefined();const query:any={where:(where:any)=>{const params=dialect.sqlToQuery(where).params;rows=rows!.filter(r=>params.includes(r.id));return query;},limit:()=>query,then:(resolve:(r:any[])=>unknown)=>Promise.resolve(rows!).then(resolve)};return query;}}),execute:async()=>[{id:game.id,title:'Game'}]};
 const read=compile(owner,{v,PAGE_SIZE:60,getDb:()=>db,getFeatureConfig:async()=>({features:{screen:true},experimentalBooks:true,experimentalComics:true}),works:s.works,musicWorks:s.musicWorks,readingWorks:s.readingWorks,sql,inArray,
  screenWorkSummaries:async(_owner:string,ids:string[])=>{calls.push(ids.length);return ids.map(id=>({id,kind:'movie',title:'Screen',year:1999}));},
  enabledCategories:()=>sql`true`,readingCard,personaliseWorkCards:async(_viewer:string,items:any[])=>{aliasedKinds.push(items.map(i=>i.kind));return items.map(i=>({...i,title:'Alias '+i.title}));}},'workSummaries');
 const requested=[...identities.map(r=>r.id),screen[0].id,comic.id],result=(await read(id,id,requested)).map((item:any)=>publicWork(item));
 expect(result.map((i:any)=>i.id)).toEqual(requested);expect(calls).toEqual([60,1]);expect(aliasedKinds.flat()).toEqual(['game','track','comic']);
 expect(result.find((r:any)=>r.id===game.id)).toEqual({id:game.id,kind:'game',title:'Alias Game',year:null});
 expect(result.find((r:any)=>r.id===comic.id)).toEqual({id:comic.id,kind:'comic',title:'Alias Comic',year:2006,attribution:{label:'Comic Vine',href:'https://comicvine.gamespot.com/actual-shape/'}});
 expect(result[0].title).toBe('Screen');
});
