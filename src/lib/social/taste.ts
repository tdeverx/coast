import {tasteDimensionsByMedium,tasteMedia,type TasteMedium} from './taste-profile';
import {displayLabel} from '#lib/ui/labels.js';
export const comparisonMedia = tasteMedia.map(({ comparison: value, label, category }) => ({ value, label, category }));
export const comparisonMediaValues = ['all', ...comparisonMedia.map(medium => medium.value)] as const;
export function comparisonSignals(medium:string) {
 const value=tasteMedia.find(entry=>entry.comparison===medium)?.value;
 const dimensions=value?tasteDimensionsByMedium[value]:[];
 return ['ratings','ratingOrder','reactions','interests',...dimensions,...(value==='show'?['creators']:[])] as const;
}
export function tasteSignalLabel(name:string,medium?:TasteMedium) {
 if(name==='ratings')return 'Rating agreement';
 if(name==='ageRatings')return 'Age rating';
 if(name==='creators')return 'Show creators';
 if(medium==='book'||medium==='comic'){
  if(name==='writers')return 'Authors';
  if(name==='tags')return 'Subjects';
  if(name==='franchises')return 'Series';
 }
 if(name==='mechanics')return 'Game modes';
 if(name==='perspectives')return 'Player perspectives';
 return displayLabel(name);
}
type TasteSignal={score:number|null;shared:number;left:number;right:number};
type RatingCell=[mine:number,theirs:number,count:number];
export type SharedTasteEvidence={ratings:RatingCell[]|null;works:number;score:number|null;reactionWorks:number;reactionScore:number|null};

/** The histogram preserves tied ranks and every shared opinion, regardless of history size. */
function ratingOrder(cells:RatingCell[],total:number) {
 if(total<5)return null;
 function centredRanks(column:0|1) {
  const counts=new Map<number,number>();
  for(const cell of cells)counts.set(cell[column],(counts.get(cell[column])??0)+cell[2]);
  if(counts.size<3)return null;
  const ranks=new Map<number,number>();
  let below=0;
  for(const [value,count] of [...counts].sort(([a],[b])=>a-b)) {
   ranks.set(value,below+(count-total)/2);
   below+=count;
  }
  return ranks;
 }
 const a=centredRanks(0),b=centredRanks(1);
 if(!a||!b)return null;
 let dot=0,left=0,right=0;
 for(const [mine,theirs,count] of cells) {
  const x=a.get(mine)!,y=b.get(theirs)!;
  dot+=x*y*count;left+=x*x*count;right+=y*y*count;
 }
 return 50*(1+Math.max(-1,Math.min(1,dot/Math.sqrt(left*right))));
}
export function sharedTasteSignals(evidence:SharedTasteEvidence,stats:{you:{rated:number;reacted:number};friend:{rated:number;reacted:number}},
 roots?:{myInterests:number;theirInterests:number;interests:number}):Record<string,TasteSignal> {
 const {works,score,reactionWorks,reactionScore}=evidence;
 const {myInterests=0,theirInterests=0,interests=0}=roots??{};
 const union=myInterests+theirInterests-interests;
 return {
  ratings:{score,shared:works,left:stats.you.rated,right:stats.friend.rated},
  ratingOrder:{score:ratingOrder(evidence.ratings??[],works),shared:works,left:works,right:works},
  reactions:{score:reactionScore,shared:reactionWorks,left:stats.you.reacted,right:stats.friend.reacted},
  interests:{score:myInterests>=5&&theirInterests>=5&&union?100*interests/union:null,shared:interests,left:myInterests,right:theirInterests},
 };
}
export function median(scores:number[]) {if(!scores.length)return null;const sorted=[...scores].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return Math.round(sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2);}
