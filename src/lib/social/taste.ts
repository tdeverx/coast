export type TasteWork={id:string;rating?:number|null;reaction?:string|null;genres:string[];interest:boolean;consumed:boolean};
export type TasteSignal={score:number|null;shared:number;left:number;right:number;weight:number};
export function cosine(a:Map<string,number>,b:Map<string,number>) {
 const dot=[...a].reduce((s,[k,n])=>s+n*(b.get(k)??0),0),norm=Math.sqrt([...a.values()].reduce((s,n)=>s+n*n,0)*[...b.values()].reduce((s,n)=>s+n*n,0));
 return norm?100*dot/norm:null;
}
export function tasteSignals(left:TasteWork[],right:TasteWork[]) {
 const byId=new Map(right.map(w=>[w.id,w]));
 const ratingPairs=left.flatMap(w=>{const other=byId.get(w.id);return w.rating!=null&&other?.rating!=null?[[w.rating,other.rating]]:[];});
 const reactionPairs=left.flatMap(w=>{const other=byId.get(w.id);return w.reaction&&other?.reaction?[[w.reaction,other.reaction]]:[];});
 const eligible=(items:TasteWork[])=>items.filter(w=>w.consumed||w.interest||w.rating!=null);
 const genres=(items:TasteWork[])=>{const map=new Map<string,number>();for(const w of eligible(items))for(const genre of new Set(w.genres.map(g=>g.toLowerCase())))map.set(genre,(map.get(genre)??0)+1);return map;};
 const ai=new Set(left.filter(w=>w.interest).map(w=>w.id)),bi=new Set(right.filter(w=>w.interest).map(w=>w.id));
 const shared=[...ai].filter(id=>bi.has(id)).length,union=new Set([...ai,...bi]).size;
 const signals:Record<string,TasteSignal>={
  ratings:{score:ratingPairs.length>=5?100*(1-ratingPairs.reduce((s,[a,b])=>s+Math.abs(a-b),0)/ratingPairs.length/4.5):null,shared:ratingPairs.length,left:left.filter(w=>w.rating!=null).length,right:right.filter(w=>w.rating!=null).length,weight:40},
  genres:{score:eligible(left).length>=5&&eligible(right).length>=5?cosine(genres(left),genres(right)):null,shared:0,left:eligible(left).length,right:eligible(right).length,weight:30},
  reactions:{score:reactionPairs.length>=5?100*reactionPairs.filter(([a,b])=>a===b).length/reactionPairs.length:null,shared:reactionPairs.length,left:left.filter(w=>w.reaction).length,right:right.filter(w=>w.reaction).length,weight:20},
  interests:{score:ai.size>=5&&bi.size>=5&&union?100*shared/union:null,shared,left:ai.size,right:bi.size,weight:10},
 };
 const qualified=Object.values(signals).filter(s=>s.score!==null),weight=qualified.reduce((s,v)=>s+v.weight,0);
 return {signals,score:weight?qualified.reduce((s,v)=>s+v.score!*v.weight,0)/weight:null};
}
export function median(scores:number[]) {if(!scores.length)return null;const sorted=[...scores].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return Math.round(sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2);}
