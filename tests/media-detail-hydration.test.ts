import {expect,test} from 'bun:test';
import {and,asc,desc,eq,inArray,or,sql} from 'drizzle-orm';
import * as v from 'valibot';
import * as s from '../src/lib/server/db/schema';
import {AppError} from '../src/lib/server/security/errors';

// Exercise the whole composition owner at its existing I/O boundaries. Actual
// catalogue comparisons separately cover the real SQL and full detail DTOs.
const source=await Bun.file(new URL('../src/lib/server/queries/media.ts',import.meta.url)).text();
const compose=source.slice(source.indexOf('export async function detailsData('));
const occurrence=source.slice(source.indexOf('export function applySequenceEntry('),source.indexOf('export async function sequenceNextView('));
const compile=(dependencies:Record<string,unknown>)=>new Function(...Object.keys(dependencies),
  new Bun.Transpiler({loader:'ts'}).transformSync(occurrence+'\n'+compose).replaceAll('export ','')+'\nreturn detailsData;'
)(...Object.values(dependencies));

test('detail hydration reuses base identities while preserving repeated sequence occurrences and fresh requests',async()=>{
  const [owner,root,parentB,parentA,leaf,missing,other,next]=Array.from({length:8},()=>crypto.randomUUID());
  const card=(id:string,title=id,kind='movie')=>Object.freeze({id,title,kind,progress:7,duration:100,watched:false,
    artwork:Object.freeze({poster:'saved-artwork'}),trackingProgress:Object.freeze({unit:'seconds',value:7,total:100})});
  const rootCard=card(root),leafCard=card(leaf,'First observation');
  const cards=new Map<string,ReturnType<typeof card>>([[root,rootCard],[parentB,card(parentB,'B','collection')],
    [parentA,card(parentA,'A','collection')],[leaf,leafCard],[other,card(other)]]);
  const entry=(mediaId:string,entryId:string,progress:number)=>({mediaId,entryId,progress,duration:100,watched:false,dropped:false,startedAt:null});
  const sequences=new Map<string,ReturnType<typeof entry>[]>([[parentB,[entry(leaf,'b/first',10),entry(root,'b/root',20),entry(leaf,'b/repeated',30),entry(missing,'b/missing',40)]],
    [parentA,[entry(leaf,'a/shared',50),entry(other,'a/other',60),entry(missing,'a/missing',70)]]]);
  const relationships=[parentB,parentA].map((parentId,position)=>({parentId,childId:root,kind:'collection',position}));
  const requested:string[][]=[],nextCalls:string[]=[];
  const nextCard=card(next);
  const db={select:()=>{
    let table:unknown;
    const query:any={from:(value:unknown)=>{table=value;return query;},where:()=>query,innerJoin:()=>query,orderBy:()=>query,limit:()=>query,
      then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(table===s.mediaRelationships?relationships:[]).then(resolve)};
    return query;
  }};
  const details=compile({v,uuidSchema:v.pipe(v.string(),v.uuid()),s,and,asc,desc,eq,inArray,or,sql,AppError,getDb:()=>db,
    mediaViews:async(_owner:string,{ids}:{ids:string[]})=>{requested.push(ids);return ids.flatMap(id=>cards.has(id)?[cards.get(id)!]:[]);},
    mediaViewsForIds:async(_owner:string,ids:string[])=>{requested.push(ids);return [...new Set(ids)].flatMap(id=>cards.has(id)?[cards.get(id)!]:[]);},
    sequenceEntries:async(_owner:string,{id}:{id:string})=>sequences.get(id)??[],
    nextPlayable:async(_owner:string,item:{id:string})=>{nextCalls.push(item.id);return nextCard;},
    permittedAvailability:()=>sql`true`,getConfig:async()=>({cacheTmdbArtwork:false}),tmdbArtworkUrl:(value:unknown)=>value});
  const first=await details(owner,root);
  expect(first.related.map((item:{id:string})=>item.id)).toEqual([parentB,parentA]);
  expect(first.collections.map((collection:{id:string})=>collection.id)).toEqual([parentB,parentA]);
  expect(first.collections.map((collection:{items:{id:string;entryId:string}[]})=>collection.items.map(item=>[item.id,item.entryId])))
    .toEqual([[[leaf,'b/first'],[root,'b/root'],[leaf,'b/repeated']],[[leaf,'a/shared'],[other,'a/other']]]);
  const occurrences=first.collections.flatMap((collection:{items:any[]})=>collection.items);
  expect(occurrences.filter((item:{id:string})=>item.id===leaf).map((item:{progress:number})=>item.progress)).toEqual([10,30,50]);
  expect(new Set(occurrences).size).toBe(5);
  expect(new Set(occurrences.map((item:{trackingProgress:unknown})=>item.trackingProgress)).size).toBe(5);
  expect(occurrences.filter((item:{id:string})=>item.id===leaf).every((item:{artwork:unknown})=>item.artwork===leafCard.artwork)).toBe(true);
  expect(leafCard.progress).toBe(7);expect(leafCard.trackingProgress.value).toBe(7);expect('sequence' in leafCard).toBe(false);
  expect(first.next).toBe(nextCard);expect(nextCalls).toEqual([root]);
  const admitted=requested.flat();expect(admitted).toHaveLength(6);expect(new Set(admitted).size).toBe(6);
  expect(admitted.filter(id=>id===missing)).toHaveLength(1);

  // A new composition must re-observe both changed cards and a formerly missing
  // card. Neither successful nor missing identities may escape this request.
  requested.length=0;cards.set(leaf,card(leaf,'Second observation'));cards.set(missing,card(missing,'Now visible'));
  const second=await details(owner,root);
  expect(second.collections[0].items.map((item:{entryId:string})=>item.entryId)).toEqual(['b/first','b/root','b/repeated','b/missing']);
  expect(second.collections[1].items.map((item:{entryId:string})=>item.entryId)).toEqual(['a/shared','a/other','a/missing']);
  expect(second.collections.flatMap((collection:{items:any[]})=>collection.items).filter((item:{id:string})=>item.id===leaf)
    .every((item:{title:string})=>item.title==='Second observation')).toBe(true);
  expect(requested.flat().filter(id=>id===missing)).toHaveLength(1);expect(requested.flat()).toHaveLength(6);
  expect(nextCalls).toEqual([root,root]);
});
