// bun ordinal-inputs.ts <frozen-captures.json> <verified-rating-dates.json> <private-output.json>
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {workFold,trainReplayReference,type TasteReplayDataset} from '../../../scripts/taste-replay';
import {scorerFromReference,type TasteReference} from '../../../src/lib/social/taste-profile';
import {trainTasteMedium} from '../../../src/lib/social/taste-training';

type Dated = {id:string;medium:'movie'|'show';at:string;stars:number};
type Example = {id:string;stars:number;score:number|null;at?:string};
type Fold = {medium:string;split:string;fold:string;train:Example[];test:Example[]};
const [capturePath,datesPath,outputPath]=Bun.argv.slice(2);
if(!capturePath||!datesPath||!outputPath)throw new Error('Expected capture, verified rating dates and a new private output path.');
const datasets:TasteReplayDataset[]=await Bun.file(capturePath).json();
const dates:Dated[]=await Bun.file(datesPath).json();
const folds:Fold[]=[];
const hashFold=(s:string)=>createHash('sha256').update(s).digest()[0]%5;

for(const data of datasets) {
  if(data.medium!=='movie' && data.medium!=='show')continue;
  const medium=data.medium;
  const metadata=new Map(data.history.map(r=>[r.work.id,r.features]));
  for(const r of data.catalogue)metadata.set(r.id,r.features);
  function estimates(rows:{id:string;stars:number;at?:string}[],ref:TasteReference):Example[] {
    const score=scorerFromReference(ref);
    return rows.map(({id,stars,at})=>({id,stars,...(at?{at}:{}),score:score(metadata.get(id)??{}).score}));
  }
  const parents=new Map<string,string>();
  function root(key:string) {
    let next;
    while((next=parents.get(key))!==undefined)key=next;
    return key;
  }
  for(const r of data.history) {
    const related=[...(r.collections??[]).map(k=>'collection:'+k),...(r.features.franchises??[]).map(t=>'feature:'+t.id)];
    for(const key of related) {
      const a=root(key),b=root(r.work.id);
      if(a!==b)parents.set(a<b?b:a,a<b?a:b);
    }
  }
  for(const split of ['work','franchise','reassigned franchise']) {
    const foldOf=(id:string)=>split==='work'?workFold(id):split==='franchise'?workFold(root(id)):hashFold('coast-ordinal-eval-v1:'+root(id));
    const seen=new Map<string,Example[]>();
    async function held(excluded:number[]) {
      const key=excluded.toSorted((a,b)=>a-b).join(',');
      if(!seen.has(key)){
        const train=data.history.filter(r=>!excluded.includes(foldOf(r.work.id)));
        const tests=data.history.flatMap(r=>excluded.includes(foldOf(r.work.id)) && r.work.rating!==null?[{id:r.work.id,stars:r.work.rating}]:[]);
        seen.set(key,estimates(tests,await trainReplayReference(data,train,true)));
      }
      return seen.get(key)!;
    }
    for(let outer=0;outer<5;outer++){
      const train:Example[]=[];
      for(let inner=0;inner<5;inner++){
        if(inner!==outer)train.push(...(await held([outer,inner])).filter(row=>foldOf(row.id)===inner));
      }
      folds.push({medium,split,fold:String(outer),train,test:await held([outer])});
    }
  }

  const dated=dates.filter(row=>row.medium===medium && metadata.has(row.id));
  for(const [cutoff,end] of [['2022','2024'],['2024','2027']]){
    const earlier=dated.filter(r=>r.at.slice(0,4)<cutoff);
    const later=dated.filter(r=>r.at.slice(0,4)>=cutoff && r.at.slice(0,4)<end);
    const asOf=Date.parse(cutoff+'-01-01T00:00:00Z')-1;
    const dayFold=(r:Dated)=>hashFold('past-day-ordinal:'+r.at.slice(0,10));
    async function directRatings(train:Dated[],test:Dated[]) {
      const fit=trainTasteMedium(medium,train.length,null,asOf);
      for(const r of train) {
        fit.add({features:metadata.get(r.id)??{},work:{id:r.id,kind:medium,medium,rating:r.stars,lastRatedAt:r.at,
          explicit:0,implicit:0,consumed:false,repeated:false,chosen:false}});
      }
      return estimates(test,(await fit.finish()).reference);
    }
    const train:Example[]=[];
    for(let inner=0;inner<5;inner++){
      train.push(...await directRatings(earlier.filter(r=>dayFold(r)!==inner),earlier.filter(r=>dayFold(r)===inner)));
    }
    folds.push({medium,split:'rating date',fold:cutoff,train,test:await directRatings(earlier,later)});
  }
}
await writeFile(outputPath,JSON.stringify(folds),{flag:'wx',mode:0o600});
