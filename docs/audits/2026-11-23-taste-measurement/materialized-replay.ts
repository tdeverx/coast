// bun materialized-replay.ts <frozen TasteReplayDataset[] JSON>
import {createHash} from 'node:crypto';
import {trainReplayReference,type TasteReplayDataset} from '../../../scripts/taste-replay';
import {scorerFromReference,type TasteFeatures,type TasteReference} from '../../../src/lib/social/taste-profile';

type Item = {id:string;features:TasteFeatures};
type Score = number|null;
const [capturePath]=Bun.argv.slice(2);
if(!capturePath)throw new Error('Pass the path to the private frozen catalogue and history capture.');
const datasets:TasteReplayDataset[]=await Bun.file(capturePath).json();

function sample<T>(items:T[],key:(item:T)=>string,limit:number) {
  return items.map(item=>({item,order:createHash('sha256').update('reference-parity-v1:'+key(item)).digest('hex')}))
    .sort((a,b)=>a.order.localeCompare(b.order)).slice(0,limit).map(row=>row.item);
}

function materialize(reference:TasteReference,items:Item[]) {
  const score=scorerFromReference(reference);
  return new Map(items.map(item=>[item.id,score(item.features).score] as const));
}

// Independently load the published reference and read cards in reverse order, 24 at a time.
function readCards(publication:TasteReference,items:Item[]) {
  const rows=items.toReversed(),results=new Map<string,Score>();
  const bytes=JSON.stringify(publication);
  for(let start=0;start<rows.length;start+=24) {
    const score=scorerFromReference(JSON.parse(bytes));
    for(const row of rows.slice(start,start+24))results.set(row.id,score(row.features).score);
  }
  return results;
}

function compare(before:Map<string,Score>,after:Map<string,Score>) {
  const stats={titles:after.size,withheldBefore:0,withheldAfter:0,changed:0,becameWithheld:0,becameScorable:0,
    increased:0,decreased:0,movedAtLeastTwo:0,maximumMove:0,crossed80:0};
  for(const [id,next] of after) {
    if(!before.has(id))throw new Error('Missing original title.');
    const old=before.get(id)!;
    if(old===null)stats.withheldBefore++;
    if(next===null)stats.withheldAfter++;
    if(old===next)continue;
    stats.changed++;
    if(next===null){stats.becameWithheld++;continue;}
    if(old===null){stats.becameScorable++;continue;}
    const distance=Math.abs(next-old);
    if(next>old)stats.increased++;else stats.decreased++;
    if(distance>=2)stats.movedAtLeastTwo++;
    if((old>=80)!==(next>=80))stats.crossed80++;
    stats.maximumMove=Math.max(stats.maximumMove,distance);
  }
  return stats;
}

for(const data of datasets) {
  if(data.medium!=='movie'&&data.medium!=='show')continue;
  const original=await trainReplayReference(data,data.history,true);
  const catalogue=data.catalogue;
  if(new Set(catalogue.map(r=>r.id)).size!==catalogue.length)throw new Error('Duplicate canonical root.');
  const initial=materialize(original,catalogue);
  const unchanged=compare(initial,readCards(original,catalogue));

  // Choose one previously rated root independently of its influence or test scores.
  const [edited]=sample(data.history.filter(r=>r.work.rating!==null&&r.work.rating>=4.5&&
    r.work.ratingReliability===1&&!r.credits?.length),r=>r.work.id,1);
  if(!edited)throw new Error('No eligible direct rating.');
  const revised=await trainReplayReference(data,data.history.map(r=>r===edited?{...r,work:{...r.work,rating:2}}:r),true);
  const revisedRead=readCards(revised,catalogue);
  const revisedMaterialized=materialize(revised,catalogue);
  const staleAfterRating=compare(initial,revisedRead);
  const afterRatingParity=compare(revisedMaterialized,revisedRead);

  // Alter the metadata of 24 unfamiliar titles. Leave personal history and the published reference frozen.
  const targets=sample(catalogue.filter(r=>!r.observed&&!!r.features.genres?.length&&!!r.features.tags?.length),r=>r.id,24);
  const changedIds=new Set(targets.map(r=>r.id));
  function metadataRun(mutate:(features:TasteFeatures)=>TasteFeatures) {
    const items=catalogue.map(r=>changedIds.has(r.id)?{id:r.id,features:mutate(r.features)}:r);
    const current=readCards(original,items);
    const changed=compare(initial,new Map([...current].filter(([id])=>changedIds.has(id))));
    const controls=compare(initial,new Map([...current].filter(([id])=>!changedIds.has(id))));
    const freshParity=compare(materialize(original,items),current);
    return {changed,controlMismatches:controls.changed,freshMismatches:freshParity.changed};
  }
  const removeGenreTag=metadataRun(({genres,tags,...rest})=>rest);
  const removeAll=metadataRun(()=>({}));
  if(unchanged.changed||afterRatingParity.changed||[removeGenreTag,removeAll].some(r=>r.controlMismatches||r.freshMismatches))
    throw new Error('Fresh materialized and independent card scores disagree, or a control moved.');
  console.log(JSON.stringify({medium:data.medium,unchanged,ratingChange:[edited.work.rating,2],staleAfterRating,
    afterRatingMismatches:afterRatingParity.changed,removeGenreTag,removeAll}));
}
