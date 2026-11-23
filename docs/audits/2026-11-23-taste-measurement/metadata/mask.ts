import {workFold,trainReplayReference} from '../../../../scripts/taste-replay.ts';
import {scorerFromReference} from '../../../../src/lib/social/taste-profile.ts';
import {writeFile} from 'node:fs/promises';
const [source,output]=Bun.argv.slice(2);
if(!source||!output)throw Error('Usage: bun mask.ts <frozen-history.json> <private-output.json>');
const datasets=await Bun.file(source).json();
const out=[];
for(const d of datasets){
 const c=new Map(d.catalogue.filter(r=>r.observed).map(r=>[r.id,r.features])),held=d.history.filter(r=>r.work.rating!==null);
 for(let f=0;f<5;f++){
  const calc=scorerFromReference(await trainReplayReference(d,d.history.filter(r=>workFold(r.work.id)!==f),true));
  for(const r of held.filter(r=>workFold(r.work.id)===f)){
   const id=r.work.id,features=c.get(id)??r.features;
   const limit={...features};delete limit.ageRatings;
   for(const dim of Object.keys(limit))limit[dim]=limit[dim].slice(0,dim==='tags'||dim==='genres'?3:dim==='cast'?5:1);
   const slim={genres:features.genres?.slice(0,3),tags:features.tags?.slice(0,3),cast:features.cast?.slice(0,5),studios:features.studios?.slice(0,1),networks:features.networks?.slice(0,1)};
   const b=calc(features);out.push({id,medium:d.medium,fold:f,score:b.score,confidence:b.confidence,cap:calc(limit).score,sparse:calc(slim).score,noCertificate:calc({...features,ageRatings:undefined}).score});
  }
 }
}
await writeFile(output,JSON.stringify(out),{mode:0o600});
