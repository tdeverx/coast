export type WeightedRow={key:string;category:string;surface?:string;weight:number};
function unit(seed:string){let hash=2166136261;for(const character of seed){hash=Math.imul(hash^character.charCodeAt(0),16777619);}return ((hash>>>0)+1)/4294967297;}
/** One stable artwork format per row/visit; music retains its native square shape. */
export function dynamicRowShape(row:Pick<WeightedRow,'key'|'category'>,seed:string):'square'|'poster'|'fanart' {
 return row.category==='music'?'square':unit(`${seed}:artwork:${row.key}`)<.5?'poster':'fanart';
}
/** Weighted shuffle is deterministic for a visit; diversify without mutating appended rows. */
export function rankRows<T extends WeightedRow>(rows:T[],seed:string):T[]{
 const pool=rows.map(row=>({row,rank:-Math.log(unit(`${seed}:${row.key}`))/Math.max(.01,row.weight)}));
 const result:T[]=[];
 while(pool.length){
  const previous=result.at(-1);
  const repetition=(row:T)=>(previous?.category===row.category?2:1)*(previous?.surface&&previous.surface===row.surface?2:1);
  pool.sort((a,b)=>a.rank*repetition(a.row)-b.rank*repetition(b.row)||a.row.key.localeCompare(b.row.key));
  result.push(pool.shift()!.row);
 }
 return result;
}
export type GenreReason='liked'|'watched'|'saved'|'explore';
export function genreReason(consumed:number,positive:number):GenreReason{return positive>0||consumed>=2?'liked':consumed>0?'watched':'saved';}
