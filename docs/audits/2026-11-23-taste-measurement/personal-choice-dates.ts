// Prepare strictly past, no-ratings Coast controls for the verified first-experience cohorts.
import {writeFile} from 'node:fs/promises';
import {trainReplayReference,type TasteReplayDataset} from '../../../scripts/taste-replay';
import {scorerFromReference} from '../../../src/lib/social/taste-profile';
const [input,capture,dates,output]=Bun.argv.slice(2);
if(!output)throw Error('Supply private watch events, capture, verified rating dates and a new output path.');
const raw:{watches:{root:string;kind:string;special:boolean;season_number:number|null;at:string}[]}=await Bun.file(input).json();
const works:TasteReplayDataset[]=await Bun.file(capture).json();
const ratings:{id:string;medium:string;stars:number;at:string}[]=await Bun.file(dates).json();
const marks=new Map<string,number[]>();
for(const event of raw.watches){
 if(event.kind==='episode' && (event.special || (event.season_number??0)<=0))continue;
 const dates=marks.get(event.root)??[];
 dates.push(Date.parse(event.at));
 marks.set(event.root,dates);
}
const results=[];
for(const data of works){
 const features=new Map(data.history.map(r=>[r.work.id,r.features]));
 for(const r of data.catalogue)if(r.observed)features.set(r.id,r.features);
 for(const year of [2022,2024]){
  const asOf=Date.UTC(year,0,1)-1;
  const training=data.history.flatMap(r=>{
   const watches=(marks.get(r.work.id)??[]).filter(t=>t<=asOf);
   if(!watches.length)return [];
   return [{features:r.features,work:{id:r.work.id,kind:r.work.kind,medium:r.work.medium,
    implicit:3,explicit:0,consumed:true,chosen:true,repeated:false,rating:null,
    lastExperiencedAt:new Date(Math.max(...watches)).toISOString()}}];
  });
  const score=scorerFromReference(await trainReplayReference(data,training,false,asOf));
  for(const r of ratings){
   if(r.medium!==data.medium || !features.has(r.id))continue;
   const at=Date.parse(r.at),times=marks.get(r.id);
   const through=year===2022?Date.UTC(2024,0,1)-1:data.asOf;
   if(at<=asOf || at>through || !times?.length || Math.min(...times)<=asOf)continue;
   results.push({...r,year,score:score(features.get(r.id)!).score});
  }
 }
}
await writeFile(output,JSON.stringify(results),{flag:'wx',mode:0o600});
