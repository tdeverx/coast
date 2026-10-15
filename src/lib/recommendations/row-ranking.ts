import type {GenreReason} from './model';
export type WeightedRow={key:string;category:string;surface?:string;weight:number};
function unit(seed:string){let hash=2166136261;for(const character of seed){hash=Math.imul(hash^character.charCodeAt(0),16777619);}return ((hash>>>0)+1)/4294967297;}
/** One stable artwork format per row/visit; music retains its native square shape. */
export function dynamicRowShape(row:Pick<WeightedRow,'key'|'category'>,seed:string):'square'|'poster'|'fanart' {
 return row.category==='reading'?'poster':row.category==='music'?'square':unit(`${seed}:artwork:${row.key}`)<.5?'poster':'fanart';
}
/** Weighted shuffle is deterministic for a visit; diversify without mutating appended rows. */
export function rankRows<T extends WeightedRow>(rows:T[],seed:string):T[]{
 type Entry={row:T;rank:number;index:number};
 const ranked=rows.map((row,index)=>({row,rank:-Math.log(unit(`${seed}:${row.key}`))/Math.max(.01,row.weight),index}))
  .sort((a,b)=>a.rank-b.rank||a.row.key.localeCompare(b.row.key));
 // Within a category/surface bucket every remaining row receives the same
 // repetition multiplier. Its pre-sorted head is therefore always its minimum.
 const groups=new Map<string,Map<string|undefined,Entry[]>>();
 for(const entry of ranked){
  let surfaces=groups.get(entry.row.category);
  if(!surfaces){surfaces=new Map();groups.set(entry.row.category,surfaces);}
  const bucket=surfaces.get(entry.row.surface);
  if(bucket)bucket.push(entry);else surfaces.set(entry.row.surface,[entry]);
 }
 const buckets=[...groups.values()].flatMap(surfaces=>[...surfaces.values()].map(entries=>({entries,next:0})));
 const result:T[]=[];
 const multiplier=(row:T,previous:T|undefined)=>(previous?.category===row.category?2:1)*(previous?.surface&&previous.surface===row.surface?2:1);
 function compare(a:Entry,b:Entry){
  const previous=result.at(-1);
  const order=a.rank*multiplier(a.row,previous)-b.rank*multiplier(b.row,previous)||a.row.key.localeCompare(b.row.key);
  if(order)return order;
  // A stable full-pool sort used the preceding sort's order for exact ties.
  // Retain that behavior even for duplicate/collation-equivalent keys.
  for(let index=result.length-2;index>=-1;index--){
   const prior=index<0?undefined:result[index];
   const tie=a.rank*multiplier(a.row,prior)-b.rank*multiplier(b.row,prior);
   if(tie)return tie;
  }
  return a.index-b.index;
 }
 while(result.length<rows.length){
  let chosen:typeof buckets[number]|undefined;
  for(const bucket of buckets)if(bucket.next<bucket.entries.length&&(!chosen||compare(bucket.entries[bucket.next],chosen.entries[chosen.next])<0))chosen=bucket;
  result.push(chosen!.entries[chosen!.next++].row);
 }
 return result;
}
export function genreReason(consumed:number,positive:number):GenreReason{return positive>0||consumed>=2?'liked':consumed>0?'watched':'saved';}
