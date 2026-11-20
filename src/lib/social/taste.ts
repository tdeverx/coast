import {buildTasteProfile,tasteDimensions,tasteMedia,type TasteFeatures} from './taste-profile';
export const comparisonMedia = tasteMedia.map(({ comparison: value, label, category }) => ({ value, label, category }));
export const comparisonMediaValues = ['all', ...comparisonMedia.map(medium => medium.value)] as const;
export const comparisonSignals = ['ratings','ratingOrder','genres','reactions','interests',...tasteDimensions.filter(dimension => dimension !== 'genres')] as const;
export type TasteWork={id:string;rating?:number|null;reaction?:string|null;genres:string[];interest:boolean;consumed:boolean;features?:TasteFeatures};
type TasteSignal={score:number|null;shared:number;left:number;right:number;weight:number};
function cosine(a:Map<string,number>,b:Map<string,number>) {
 const dot=[...a].reduce((s,[k,n])=>s+n*(b.get(k)??0),0),norm=Math.sqrt([...a.values()].reduce((s,n)=>s+n*n,0)*[...b.values()].reduce((s,n)=>s+n*n,0));
 return norm?100*dot/norm:null;
}
/** Spearman agreement over the same titles, giving tied star ratings their average rank. */
function ratingOrder(pairs:number[][]){
 if(pairs.length<5)return null;
 function centeredRanks(column:number){
  const values=pairs.map(pair=>pair[column]);
  const counts=new Map<number,number>();
  for(const value of values)counts.set(value,(counts.get(value)??0)+1);
  if(counts.size<3)return null;
  const ranks=new Map<number,number>();
  let below=0;
  for(const value of [...counts.keys()].sort((a,b)=>a-b)){
   const count=counts.get(value)!;
   ranks.set(value,below+(count-pairs.length)/2);
   below+=count;
  }
  return values.map(value=>ranks.get(value)!);
 }
 const a=centeredRanks(0),b=centeredRanks(1);
 if(!a||!b)return null;
 let dot=0,left=0,right=0;
 for(let i=0;i<a.length;i++){dot+=a[i]*b[i];left+=a[i]**2;right+=b[i]**2;}
 return 50*(1+Math.max(-1,Math.min(1,dot/Math.sqrt(left*right))));
}
export function tasteSignals(left:TasteWork[],right:TasteWork[]) {
 const byId=new Map(right.map(w=>[w.id,w]));
 const ratingPairs=left.flatMap(w=>{const other=byId.get(w.id);return w.rating!=null&&other?.rating!=null?[[w.rating,other.rating]]:[];});
 const reactionPairs=left.flatMap(w=>{const other=byId.get(w.id);return w.reaction&&other?.reaction?[[w.reaction,other.reaction]]:[];});
 const eligible=(items:TasteWork[])=>items.filter(w=>w.consumed||w.interest||w.rating!=null);
 const genres=(items:TasteWork[])=>{const map=new Map<string,number>();for(const w of items.filter(work=>work.rating==null||work.rating>=2.5))for(const genre of new Set(w.genres.map(g=>g.toLowerCase())))map.set(genre,(map.get(genre)??0)+1);return map;};
 const leftEligible=eligible(left),rightEligible=eligible(right);
 const leftGenres=genres(leftEligible),rightGenres=genres(rightEligible);
 const ai=new Set(left.filter(w=>w.interest).map(w=>w.id)),bi=new Set(right.filter(w=>w.interest).map(w=>w.id));
 const shared=[...ai].filter(id=>bi.has(id)).length,union=new Set([...ai,...bi]).size;
 const order=ratingOrder(ratingPairs);
 const signals:Record<string,TasteSignal>={
  ratings:{score:ratingPairs.length>=5?100*(1-ratingPairs.reduce((s,[a,b])=>s+Math.abs(a-b),0)/ratingPairs.length/4.5):null,shared:ratingPairs.length,left:left.filter(w=>w.rating!=null).length,right:right.filter(w=>w.rating!=null).length,weight:order===null?40:28},
  ratingOrder:{score:order,shared:ratingPairs.length,left:ratingPairs.length,right:ratingPairs.length,weight:12},
  genres:{score:leftEligible.length>=5&&rightEligible.length>=5?cosine(leftGenres,rightGenres):null,
    shared:[...leftGenres.keys()].filter(genre=>rightGenres.has(genre)).length,left:leftEligible.length,right:rightEligible.length,weight:30},
  reactions:{score:reactionPairs.length>=5?100*reactionPairs.filter(([a,b])=>a===b).length/reactionPairs.length:null,shared:reactionPairs.length,left:left.filter(w=>w.reaction).length,right:right.filter(w=>w.reaction).length,weight:20},
  interests:{score:ai.size>=5&&bi.size>=5&&union?100*shared/union:null,shared,left:ai.size,right:bi.size,weight:10},
 };
 // Share the same feature-profile builder with personal recommendations, using only visible evidence.
 const featureProfile=(items:TasteWork[])=>buildTasteProfile(items.map(work=>({id:work.id,weight:work.rating!=null?(work.rating<2.5?-5:work.rating>=3.5?5:0):['❤️','🔥'].includes(work.reaction??'')?4:work.interest?1:work.consumed?1:0,features:work.features??{}})));
 const a=featureProfile(left),b=featureProfile(right);
 for(const dimension of tasteDimensions.filter(value=>value!=='genres')){
  const av=(a.dimensions[dimension]??[]).filter(value=>value.value>0&&(dimension!=='cast'||value.samples>=2)),bv=(b.dimensions[dimension]??[]).filter(value=>value.value>0&&(dimension!=='cast'||value.samples>=2));
  const rightValues=new Map(bv.map(v=>[v.id,v.value]));
  signals[dimension]={score:a.works>=5&&b.works>=5&&av.length&&bv.length?cosine(new Map(av.map(v=>[v.id,v.value])),rightValues):null,shared:av.reduce((shared,v)=>shared+(rightValues.has(v.id)?1:0),0),left:av.length,right:bv.length,weight:dimension==='decades'?0:dimension==='publishers'?2:5};
 }
 const qualified=Object.values(signals).filter(s=>s.score!==null),weight=qualified.reduce((s,v)=>s+v.weight,0);
 return {signals,score:weight?qualified.reduce((s,v)=>s+v.score!*v.weight,0)/weight:null};
}
export function median(scores:number[]) {if(!scores.length)return null;const sorted=[...scores].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return Math.round(sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2);}
