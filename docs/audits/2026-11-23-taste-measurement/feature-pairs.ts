// In-memory sensitivity of a single viewer's real reference to two attributes.
// bun feature-pairs.ts private-capture.json movie studios "studio ghibli" tags tmdb:210024
import {trainReplayReference,type TasteReplayDataset} from '../../../scripts/taste-replay';
import {scorerFromReference,type TasteDimension,type TasteFeatures} from '../../../src/lib/social/taste-profile';
const [path,medium,firstGroup,firstId,secondGroup,secondId]=Bun.argv.slice(2);
if(!path||!secondId||firstGroup===secondGroup)throw Error('Supply a dataset, medium and two distinct families and IDs.');
const ds:TasteReplayDataset[]=await Bun.file(path).json();
const d=ds.find(r=>r.medium===medium);
if(!d)throw Error('Medium missing from capture.');
const families=[firstGroup,secondGroup] as TasteDimension[], ids=[firstId,secondId];
const tokens=families.map((f,i)=>d.catalogue.flatMap(r=>r.features[f]??[]).find(t=>t.id===ids[i]));
if(!tokens[0]||!tokens[1])throw Error('Attribute missing in catalogue.');
const has=(features:TasteFeatures,i:number)=>features[families[i]]?.some(t=>t.id===ids[i])??false;
const training=d.history.map(r=>({...r,audience:undefined}));
const supports=[0,1,2,3].map(mask=>{
  const rows=training.filter(r=>Number(has(r.features,0))+2*Number(has(r.features,1))===mask);
  return {mask,chosen:rows.filter(r=>r.work.chosen).length,rated:rows.filter(r=>r.work.rating!==null).length,
    liked:rows.filter(r=>r.work.rating!==null && r.work.rating>=4).length};
});
console.log(JSON.stringify({medium,ids,supports}));
function distribution(xs:number[]) {
  const ordered=xs.toSorted((a,b)=>a-b);
  const quantile=(p:number)=>{
    const at=(ordered.length-1)*p,i=Math.floor(at);
    return ordered[i]+(ordered[Math.ceil(at)]-ordered[i])*(at-i);
  };
  return ordered.length?[quantile(.25),quantile(.5),quantile(.75)]:null;
}
// Each comparison keeps exactly the same background movie features and profile.
const anchors=d.catalogue.filter(r=>!r.observed && has(r.features,1));
for(const rated of [true,false]){
  const reference=await trainReplayReference(d,training,rated);
  const score=scorerFromReference(reference), withoutChoice=scorerFromReference({...reference,selection:undefined});
  const complete:number[][]=[], choiceRemoved:number[][]=[];
  for(const r of anchors){
    const values=[0,1,2,3].map(mask=>{
      const features={...r.features};
      for(const [i,f] of families.entries()){
        features[f]=(features[f]??[]).filter(t=>t.id!==ids[i]);
        if(mask & (1<<i))features[f].push(tokens[i]!);
      }
      return [score(features).score,withoutChoice(features).score];
    });
    const full=values.map(v=>v[0]), reduced=values.map(v=>v[1]);
    if(full.every((s):s is number=>s!==null))complete.push(full);
    if(reduced.every((s):s is number=>s!==null))choiceRemoved.push(reduced);
  }
  console.log(JSON.stringify({rated,anchors:anchors.length,complete:complete.length,
    cellMedians:[0,1,2,3].map(i=>distribution(complete.map(row=>row[i]))?.[1]),
    comparableWithoutChoice:choiceRemoved.length,
    withoutChoiceMedians:[0,1,2,3].map(i=>distribution(choiceRemoved.map(row=>row[i]))?.[1]),
    firstEffectWithoutSecond:distribution(complete.map(r=>r[1]-r[0])),
    firstEffectWithSecond:distribution(complete.map(r=>r[3]-r[2])),
    secondEffectWithoutFirst:distribution(complete.map(r=>r[2]-r[0])),
    secondEffectWithFirst:distribution(complete.map(r=>r[3]-r[1]))}));
}
