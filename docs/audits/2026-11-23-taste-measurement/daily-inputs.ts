// bun daily-inputs.ts <capture.json> <verified-rating-dates.json> <new-private-output.json>
import {writeFile} from 'node:fs/promises';
import {trainTasteMedium} from '../../../src/lib/social/taste-training';
import {scorerFromReference} from '../../../src/lib/social/taste-profile';
import type {TasteReplayDataset} from '../../../scripts/taste-replay';

type Rating={id:string;at:string;medium:'movie'|'show';stars:number};
const [capture,dates,output]=Bun.argv.slice(2);
if(!capture||!dates||!output)throw new Error('Pass a frozen capture, verified UTC ratings and a new private output.');
const datasets:TasteReplayDataset[]=await Bun.file(capture).json(), ratings:Rating[]=await Bun.file(dates).json();
const forecasts:(Rating&{historySize:number;score:number|null})[]=[];
for(const data of datasets){
  if(data.medium!=='movie'&&data.medium!=='show')continue;
  const medium=data.medium;
  const features=new Map(data.history.map(r=>[r.work.id,r.features]));
  for(const r of data.catalogue)features.set(r.id,r.features);
  const history:Rating[]=[], days=new Map<string,Rating[]>(), ids=new Set<string>();
  for(const r of ratings.filter(r=>r.medium===medium&&features.has(r.id))){
    if(ids.has(r.id))throw new Error('Duplicate root in the verified rating feed.');
    ids.add(r.id);
    const day=new Date(r.at).toISOString().slice(0,10);
    if(!days.has(day))days.set(day,[]);
    days.get(day)!.push(r);
  }
  for(const day of [...days.keys()].sort()){
    const held=days.get(day)!;
    let score:ReturnType<typeof scorerFromReference>|undefined;
    if(history.length>=25){
      const fit=trainTasteMedium(medium,history.length,null,Date.parse(day+'T00:00:00Z')-1);
      for(const r of history)fit.add({features:features.get(r.id)!,work:{id:r.id,medium,kind:medium,
        rating:r.stars,lastRatedAt:r.at,explicit:0,implicit:0,consumed:false,repeated:false,chosen:false}});
      score=scorerFromReference((await fit.finish()).reference);
    }
    for(const r of held)forecasts.push({...r,historySize:history.length,score:score?.(features.get(r.id)!).score??null});
    history.push(...held);
  }
}
await writeFile(output,JSON.stringify(forecasts),{flag:'wx',mode:0o600});
