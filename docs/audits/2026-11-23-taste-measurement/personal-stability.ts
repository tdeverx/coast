// bun personal-stability.ts private-capture.json verified-rating-dates.json
// Compare a full personal profile with 12 deterministic 80% subsamples of the same person's history.
import {createHash} from 'node:crypto';
import {trainReplayReference,workFold,type TasteReplayDataset} from '../../../scripts/taste-replay';
import {scorerFromReference} from '../../../src/lib/social/taste-profile';
import {trainTasteMedium} from '../../../src/lib/social/taste-training';
type Hit={y:number;base:number;ensemble:number;band:number;spread:number};
type Dated={id:string;medium:string;at:string;stars:number};
const [capture,verified]=Bun.argv.slice(2);
if(!capture||!verified)throw Error('Supply a frozen movie/show capture and a verified date snapshot.');
const data:TasteReplayDataset[]=await Bun.file(capture).json();
const dates:Dated[]=await Bun.file(verified).json();
const keep=(key:string,run:number)=>run===0 || createHash('sha256').update('repeat-profile:'+run+':'+key).digest()[0]<205;
function metrics(groups:Hit[][],field:'base'|'ensemble'|'band') {
  let correct=0,pairs=0,count=0,weakGreen=0,fiveGreen=0;
  for(const rows of groups){
    count+=rows.length;
    weakGreen+=rows.filter(r=>r.y<=3 && r[field]>=80).length;
    fiveGreen+=rows.filter(r=>r.y===5 && r[field]>=80).length;
    for(const a of rows.filter(r=>r.y>=4))for(const b of rows.filter(r=>r.y<=3)){
      pairs++;correct+=Number(a[field]>b[field])+.5*Number(a[field]===b[field]);
    }
  }
  return {count,ordering:pairs?+(100*correct/pairs).toFixed(2):null,weakGreen,fiveGreen};
}
for(const d of data){
  const features=new Map(d.history.map(r=>[r.work.id,r.features]));
  for(const r of d.catalogue)features.set(r.id,r.features);
  for(const split of ['work','2022','2024']){
    const groups=[];
    let insufficient=0,withheld=0;
    for(let k=0;k<(split==='work'?5:1);k++){
      const earlier=d.history.filter(r=>workFold(r.work.id)!==k);
      const past=dates.filter(r=>r.medium===d.medium && r.at.slice(0,4)<split && features.has(r.id));
      const targets=split==='work'?d.history.filter(r=>workFold(r.work.id)===k && r.work.rating!==null)
        .map(r=>({id:r.work.id,stars:r.work.rating!})):dates.filter(r=>r.medium===d.medium && r.at.slice(0,4)>=split &&
          r.at.slice(0,4)<(split==='2022'?'2024':'2027') && features.has(r.id));
      const samples:(number|null)[][]=[];
      for(let run=0;run<=12;run++){
        let reference;
        if(split==='work'){
          const train=earlier.filter(r=>keep(r.work.id,run)).map(r=>({...r,audience:undefined}));
          reference=await trainReplayReference(d,train,true);
        }else{
          const selected=past.filter(r=>keep(r.id,run));
          const fit=trainTasteMedium(d.medium,selected.length,null,Date.parse(split+'-01-01T00:00:00Z')-1);
          for(const r of selected)fit.add({features:features.get(r.id)!,work:{id:r.id,kind:d.medium,medium:d.medium,
            rating:r.stars,lastRatedAt:r.at,consumed:false,repeated:false,chosen:false,implicit:0,explicit:0}});
          reference=(await fit.finish()).reference;
        }
        const score=scorerFromReference(reference);
        samples.push(targets.map(r=>score(features.get(r.id)!).score));
      }
      const hits:Hit[]=[];
      for(const [i,r] of targets.entries()){
        const base=samples[0][i];
        if(base===null){withheld++;continue;}
        const values=samples.slice(1).flatMap(v=>v[i]===null?[]:[v[i]!]).sort((a,b)=>a-b);
        if(values.length<8){insufficient++;hits.push({y:r.stars,base,ensemble:base,band:base,spread:Infinity});continue;}
        const q=(fraction:number)=>values[Math.floor((values.length-1)*fraction)];
        hits.push({y:r.stars,base,ensemble:Math.round((base+(values.reduce((a,b)=>a+b,0)/values.length))/2),
          band:base>=50?Math.min(base,q(.25)):Math.max(base,q(.75)),spread:q(.9)-q(.1)});
      }
      groups.push(hits);
    }
    const rows=groups.flat(), sorted=rows.toSorted((a,b)=>a.spread-b.spread);
    const bins=[];
    for(let n=0;n<3;n++){
      const part=sorted.slice(Math.floor(rows.length*n/3),Math.floor(rows.length*(n+1)/3));
      bins.push({n:part.length,medianSpread:part[Math.floor(part.length/2)]?.spread,
        brier:+(part.reduce((total,r)=>total+(r.base/100-Number(r.y>=4))**2,0)/part.length).toFixed(4)});
    }
    console.log(JSON.stringify({medium:d.medium,split,withheld,insufficient,
      base:metrics(groups,'base'),ensemble:metrics(groups,'ensemble'),cautious:metrics(groups,'band'),stabilityThirds:bins}));
  }
}
