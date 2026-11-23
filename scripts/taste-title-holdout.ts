// bun scripts/taste-title-holdout.ts <username> <movie|show> [canonical-work-id]
// Read-only validation. The optional ID limits the run to one title.
import {createHash} from 'node:crypto';
import {closeDb} from '../src/lib/server/db';
import {scorerFromReference,type TasteReference} from '../src/lib/social/taste-profile';
import {captureTaste,trainReplayReference,type TasteReplayDataset} from './taste-replay';

const comparisonCount=256;
const sampleKey=(id:string)=>createHash('sha256').update('item-holdout:'+id).digest('hex');

/** Select comparison titles before looking at scores or ratings. Keep the same catalogue across fits. */
export function comparisonTitles(data:TasteReplayDataset){
  return data.catalogue.filter(row=>!row.observed).map(row=>({row,key:sampleKey(row.id)}))
    .sort((a,b)=>a.key.localeCompare(b.key)).slice(0,comparisonCount).map(x=>x.row);
}

export async function* singleTitleHoldouts(data:TasteReplayDataset,workId?:string){
  const known=new Map(data.catalogue.filter(row=>row.observed).map(row=>[row.id,row.features]));
  const targets=data.history.filter(row=>row.work.rating!==null&&(!workId||row.work.id===workId));
  if(workId&&!targets.length)throw new Error('Choose a rated canonical title in this medium.');
  const full=await trainReplayReference(data,data.history,true);
  for(const row of targets){
    // Each root owns its complete episode/season evidence, rating, returns and scoped credits.
    // The fold fitter also recounts chosen pools and restores eligible withheld titles to supply.
    const blind=await trainReplayReference(data,data.history.filter(item=>item.work.id!==row.work.id),true);
    yield {id:row.work.id,rating:row.work.rating!,features:known.get(row.work.id)??row.features,full,blind};
  }
}

export function pairedPercentiles(full:number|null,blind:number|null,fullPeers:(number|null)[],blindPeers:(number|null)[]){
  if(fullPeers.length!==blindPeers.length)throw new Error('Comparison cohorts differ.');
  let n=0,a=0,b=0;
  for(const [i,x] of fullPeers.entries()){
    const y=blindPeers[i];if(x===null||y===null)continue;
    n++;
    if(full!==null)a+=Number(full>x)+Number(full===x)/2;
    if(blind!==null)b+=Number(blind>y)+Number(blind===y)/2;
  }
  return {n,full:full===null||!n?null:100*a/n,blind:blind===null||!n?null:100*b/n};
}

type Prediction={rating:number;full:number|null;blind:number|null;rank:ReturnType<typeof pairedPercentiles>};
function median(values:number[]){
  if(!values.length)return null;
  const sorted=values.toSorted((a,b)=>a-b),i=Math.floor(sorted.length/2);
  return Math.round(10*(sorted[i]+sorted[Math.floor((sorted.length-1)/2)])/2)/10;
}
export function summarizeTitleHoldouts(rows:Prediction[]){
  return [...new Set(rows.map(r=>r.rating))].sort((a,b)=>b-a).map(stars=>{
    const group=rows.filter(r=>r.rating===stars);
    const paired=group.filter((r):r is Prediction & {full:number;blind:number}=>r.full!==null&&r.blind!==null);
    const ranked=paired.filter(r=>r.rank.full!==null&&r.rank.blind!==null);
    const topBefore=ranked.filter(r=>r.rank.full!>=75);
    return {stars,titles:group.length,paired:paired.length,unscoredBlind:group.filter(r=>r.blind===null).length,
      fullMedian:median(paired.map(r=>r.full)),blindMedian:median(paired.map(r=>r.blind)),
      medianAbsoluteChange:median(paired.map(r=>Math.abs(r.full-r.blind))),
      fullPercentile:median(ranked.map(r=>r.rank.full!)),blindPercentile:median(ranked.map(r=>r.rank.blind!)),
      withinFivePoints:paired.filter(r=>Math.abs(r.full-r.blind)<=5).length,
      upperQuartileBefore:topBefore.length,upperQuartileRetained:topBefore.filter(r=>r.rank.blind!>=75).length};
  });
}

async function validate(username:string,medium:'movie'|'show',id?:string){
  const data=await captureTaste(username,medium),comparison=comparisonTitles(data),rows:Prediction[]=[];
  const score=(reference:TasteReference)=>scorerFromReference(reference);
  let fullModel:ReturnType<typeof score>|undefined,fullPeers:(number|null)[]=[];
  for await(const title of singleTitleHoldouts(data,id)){
    if(!fullModel){fullModel=score(title.full);fullPeers=comparison.map(row=>fullModel!(row.features).score);}
    const blindModel=score(title.blind),blindPeers=comparison.map(row=>blindModel(row.features).score);
    const full=fullModel(title.features).score,blind=blindModel(title.features).score;
    rows.push({rating:title.rating,full,blind,rank:pairedPercentiles(full,blind,fullPeers,blindPeers)});
  }
  return {medium,comparisonTitles:comparison.length,summary:summarizeTitleHoldouts(rows),...(id?{title:rows[0]}:{})};
}

if(import.meta.main){
  const [username,medium,id]=Bun.argv.slice(2);
  if(!username||(medium!=='movie'&&medium!=='show'))throw Error('Usage: bun scripts/taste-title-holdout.ts <username> <movie|show> [canonical-work-id]');
  try{console.log(JSON.stringify(await validate(username,medium,id),null,2));}finally{await closeDb();}
}
