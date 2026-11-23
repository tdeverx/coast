// bun solo.ts private-captures.json private-rating-dates.json
// No database, provider, peer or audience input. Outputs aggregate measurements.
import {createHash} from 'node:crypto';
import {workFold,trainReplayReference,type TasteReplayDataset} from '../../../scripts/taste-replay';
import {scorerFromReference} from '../../../src/lib/social/taste-profile';
import {trainTasteMedium} from '../../../src/lib/social/taste-training';

type Dated={id:string;medium:string;stars:number;at:string};
type Point={rating:number;score:number|null};
function summary(groups:Point[][]) {
  let ordered=0, pairs=0;
  for(const group of groups) {
    const likes=group.filter(r=>r.score!==null && r.rating>=4);
    const weak=group.filter(r=>r.score!==null && r.rating<=3);
    for(const a of likes)for(const b of weak){
      pairs++;
      ordered+=Number(a.score!>b.score!)+.5*Number(a.score===b.score);
    }
  }
  const rows=groups.flat(),scored=rows.filter(r=>r.score!==null);
  return {coverage:scored.length,total:rows.length,ordering:pairs?+(100*ordered/pairs).toFixed(2):null,
    weakGreen:scored.filter(r=>r.rating<=3 && r.score!>=80).length,
    fiveGreen:scored.filter(r=>r.rating===5 && r.score!>=80).length};
}
const [capturePath,datesPath]=Bun.argv.slice(2);
if(!capturePath||!datesPath)throw Error('Supply the private capture and verified original rating dates.');
const datasets:TasteReplayDataset[]=await Bun.file(capturePath).json();
const dates:Dated[]=await Bun.file(datesPath).json();
for(const data of datasets){
  if(data.medium!=='show' && data.medium!=='movie')continue;
  const features=new Map(data.history.map(row=>[row.work.id,row.features]));
  for(const row of data.catalogue)features.set(row.id,row.features);
  // First isolate dates as a scoring input while preserving identical chronological holdouts.
  for(const [start,end] of [['2022','2024'],['2024','2027']]){
    const earlier=dates.filter(r=>r.medium===data.medium && r.at.slice(0,4)<start && features.has(r.id));
    const later=dates.filter(r=>r.medium===data.medium && r.at.slice(0,4)>=start && r.at.slice(0,4)<end && features.has(r.id));
    const outputs=[];
    for(const useDate of [true,false]){
      const model=trainTasteMedium(data.medium,earlier.length,null,Date.parse(start+'-01-01T00:00:00Z')-1);
      for(const r of earlier)model.add({features:features.get(r.id)!,work:{id:r.id,kind:data.medium,medium:data.medium,
        rating:r.stars,explicit:0,implicit:0,consumed:false,repeated:false,chosen:false,lastRatedAt:useDate?r.at:null}});
      const score=scorerFromReference((await model.finish()).reference);
      outputs.push(later.map(r=>({rating:r.stars,score:score(features.get(r.id)!).score})));
    }
    console.log(JSON.stringify({medium:data.medium,start,dated:summary([outputs[0]]),undated:summary([outputs[1]]),
      cardsChanged:outputs[0].filter((r,i)=>r.score!==outputs[1][i].score).length}));
  }

  // Keep personal non-rating actions for every retained training work. The target is entirely hidden.
  for(const budget of [0,2,10,50,Infinity]){
    const measurements=[];
    for(const seed of Number.isFinite(budget)&&budget>0?[1,2,3]:[1]){
      const groups:Point[][]=[];
      const orderedRated=data.history.filter(r=>r.work.rating!==null)
        .map(r=>({id:r.work.id,key:createHash('sha256').update('solo:'+seed+':'+r.work.id).digest('hex')}))
        .sort((a,b)=>a.key.localeCompare(b.key));
      for(let k=0;k<5;k++){
        const keep=new Set(orderedRated.filter(r=>workFold(r.id)!==k).slice(0,budget).map(r=>r.id));
        const train=data.history.filter(r=>workFold(r.work.id)!==k).flatMap(r=>{
          const w=r.work;
          if(keep.has(w.id))return [{...r,audience:undefined}];
          if(!w.implicit && !w.explicit && !w.chosen && !w.consumed && !w.repeated && !w.dropped && !w.deliberateReturn)return [];
          return [{...r,audience:undefined,credits:undefined,work:{...w,rating:null,lastRatedAt:null}}];
        });
        const score=scorerFromReference(await trainReplayReference(data,train,true));
        groups.push(data.history.filter(r=>r.work.rating!==null && workFold(r.work.id)===k)
          .map(r=>({rating:r.work.rating!,score:score(features.get(r.work.id)!).score})));
      }
      measurements.push(summary(groups));
    }
    console.log(JSON.stringify({medium:data.medium,personalRatings:budget===Infinity?'all':budget,measurements}));
  }
}
