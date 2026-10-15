import {expect,test} from 'bun:test';
import {rankRows,genreReason} from '../src/lib/recommendations/row-ranking';
import {genreRowTitle} from '../src/lib/recommendations/row-titles';
import {TraktAdapter} from '../src/lib/providers/trakt/adapter.server';
test('row priority favours established tastes, stays stable per visit, and retains exploration',()=>{
 const rows=[{key:'interest',category:'screen',weight:12},{key:'explore',category:'game',weight:.35}];
 let first=0;for(let n=0;n<100;n++)if(rankRows(rows,String(n))[0].key==='interest')first++;
 expect(first).toBeGreaterThan(90);expect(rankRows(rows,'visit')).toEqual(rankRows(rows,'visit'));expect(rankRows(rows,'visit')).toHaveLength(2);
 expect(genreReason(0,0)).toBe('saved');expect(genreReason(1,0)).toBe('watched');expect(genreReason(2,0)).toBe('liked');expect(genreReason(0,1)).toBe('liked');
 expect(genreRowTitle('screen','Animation','movie','saved')).not.toContain('love');
 expect(genreRowTitle('screen','Animation','show','explore')).toBe('A new direction in shows: animation');
});
test('Trakt recommendations use the authenticated bounded read endpoint',async()=>{
 const adapter=new TraktAdapter(async(path,init)=>{expect(path).toBe('/recommendations/movies?limit=40');expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');return [{title:'Suggestion',year:2025,ids:{trakt:2,tmdb:3}}];},'client','secret','token');
 expect((await adapter.recommendations('movie'))[0].ids.tmdb).toBe(3);
});

// Immutable pre-optimisation algorithm is the equivalence oracle, including its
// stable-sort behavior for exact/collation ties across repetition buckets.
function previousRank<T extends {key:string;category:string;surface?:string;weight:number}>(rows:T[],seed:string):T[]{
 function unit(value:string){let hash=2166136261;for(const character of value)hash=Math.imul(hash^character.charCodeAt(0),16777619);return ((hash>>>0)+1)/4294967297;}
 const pool=rows.map(row=>({row,rank:-Math.log(unit(`${seed}:${row.key}`))/Math.max(.01,row.weight)})),result:T[]=[];
 while(pool.length){
  const previous=result.at(-1),repetition=(row:T)=>(previous?.category===row.category?2:1)*(previous?.surface&&previous.surface===row.surface?2:1);
  pool.sort((a,b)=>a.rank*repetition(a.row)-b.rank*repetition(b.row)||a.row.key.localeCompare(b.row.key));
  result.push(pool.shift()!.row);
 }
 return result;
}
test('bucket ranking exactly retains seeded weighted order, surface diversity and stable ties at scale',()=>{
 const rows=Array.from({length:1000},(_,index)=>({key:`work-${index}`,category:['screen','game','music','reading'][index%4],surface:[undefined,'seed','genre','popular'][Math.floor(index/4)%4],weight:[.01,.35,1,3,5,12][index%6],index}));
 for(const size of [0,1,100,300,1000])for(const seed of ['visit','next-visit','unicode-é']){
  const sample=rows.slice(0,size);
  expect(rankRows(sample,seed).map(row=>row.index)).toEqual(previousRank(sample,seed).map(row=>row.index));
 }
 const ties=Array.from({length:40},(_,index)=>({...rows[index],key:index%2?'é':'e\u0301',weight:1,index}));
 ties.push(...rows.slice(0,20).map((row,index)=>({...row,key:'duplicate',weight:3,index:index+40})));
 expect(rankRows(ties,'ties').map(row=>row.index)).toEqual(previousRank(ties,'ties').map(row=>row.index));
 expect(rows[0].index).toBe(0);
});
test('ranking work grows with the bounded bucket heads instead of repeated full-pool sorts',()=>{
 function count(size:number){
  let reads=0;
  const rows=Array.from({length:size},(_,index)=>({key:String(index),weight:1+index%12,get category(){reads++;return ['screen','game','music','reading'][index%4];},surface:['seed','genre','popular'][index%3]}));
  expect(rankRows(rows,'operations')).toHaveLength(size);
  return reads;
 }
 const small=count(400),large=count(800);
 expect(large).toBeLessThan(small*3);
 expect(large).toBeLessThan(100000);
});
