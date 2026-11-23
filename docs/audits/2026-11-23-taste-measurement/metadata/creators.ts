// Offline ablation: distinguish a verified show creator from a writer, using the current authorship family as a surrogate.
import {trainReplayReference,workFold,type TasteReplayDataset} from '../../../../scripts/taste-replay';
import {scorerFromReference,type TasteFeatures} from '../../../../src/lib/social/taste-profile';
import {trainTasteMedium} from '../../../../src/lib/social/taste-training';
import {writeFile} from 'node:fs/promises';

type Credit = {id:string;name:string;role:string};
type Item = {id:string;credits?:Credit[]|null};
type DatedRating = {id:string;medium:string;at:string;stars:number};
const [cohortPath,metadataPath,datesPath,output]=Bun.argv.slice(2);
if (!cohortPath||!metadataPath||!datesPath||!output) throw Error('Usage: bun creators.ts <frozen-history.json> <metadata.json> <dated-ratings.json> <private-output.json>');
const datasets:TasteReplayDataset[]=await Bun.file(cohortPath).json();
const source=datasets.find(d=>d.medium==='show');
if (!source) throw Error('The dataset must contain shows');
const metadata:Item[]=await Bun.file(metadataPath).json();
const credits=new Map(metadata.map(item=>[item.id,item.credits??[]]));
const dates:DatedRating[]=await Bun.file(datesPath).json();
const results=[];

for (const arm of ['current','creator']) {
  function extend(id:string,features:TasteFeatures):TasteFeatures {
    if (arm==='current') return features;
    const creators=(credits.get(id)??[]).filter(person=>person.role==='Creator'&&/^\d+$/.test(person.id));
    if (!creators.length) return features;
    const authors=new Map((features.writers??[]).map(person=>[person.id,person]));
    for (const person of creators) {
      const key='tmdb-creator:'+person.id;
      authors.set(key,{id:key,name:person.name});
    }
    return {...features,writers:[...authors.values()]};
  }
  const data={...source,
    catalogue:source.catalogue.map(row=>({...row,features:extend(row.id,row.features)})),
    history:source.history.map(row=>({...row,features:extend(row.work.id,row.features)})),
  };
  const features=new Map(data.history.map(row=>[row.work.id,row.features]));
  for (const row of data.catalogue) features.set(row.id,row.features);
  const labelled=data.history.filter(r=>r.work.rating!==null);
  for (const rated of [true,false]) {
    for (let fold=0;fold<5;fold++) {
      const train=data.history.filter(row=>workFold(row.work.id)!==fold);
      const score=scorerFromReference(await trainReplayReference(data,train,rated));
      for (const row of labelled) {
        const id=row.work.id;
        if (workFold(id)!==fold) continue;
        results.push({arm,split:'work',rated,id,fold,score:score(features.get(id)!).score});
      }
    }
  }
  const rows=dates.filter(row=>row.medium==='show'&&features.has(row.id));
  for (const cutoff of ['2022','2024']) {
    const train=rows.filter(row=>row.at.slice(0,4)<cutoff);
    const end=cutoff==='2022'?'2024':'2027';
    const held=rows.filter(row=>row.at.slice(0,4)>=cutoff&&row.at.slice(0,4)<end);
    const fit=trainTasteMedium('show',train.length,null,Date.parse(cutoff+'-01-01T00:00:00Z')-1);
    for (const row of train) {
      fit.add({features:features.get(row.id)!,work:{id:row.id,kind:'show',medium:'show',rating:row.stars,
        explicit:0,implicit:0,consumed:false,repeated:false,chosen:false,lastRatedAt:row.at}});
    }
    const score=scorerFromReference((await fit.finish()).reference);
    for (const row of held) results.push({arm,split:cutoff,rated:true,id:row.id,score:score(features.get(row.id)!).score});
  }
}
await writeFile(output,JSON.stringify(results),{mode:0o600});
