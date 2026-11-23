// Private developer publication. Freeze the research model and score actual new catalogue roots.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import type {TasteReplayDataset} from '../../../scripts/taste-replay';
import {workFold} from '../../../scripts/taste-replay';
import {trainTasteV2,scoreTasteV2,type TasteV2Profile,type TasteV2Medium,type TasteV2Features} from '../../../src/lib/social/taste-v2';
import {buildScorers,creatorAugmenter,mask} from '../2026-11-23-taste-dislikes/breakdowns-ablation';

const [snapshotPath,gradedPath,capturePath,metadataPath,cataloguePath,labelsPath,publicPath,innerPath,panelsPath,
  moviesPath,showsPath,output,option]=Bun.argv.slice(2);
assert(output && (!option||option==='--complete-known'));
const read=(p:string)=>Bun.file(p).json();
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const graded=await read(gradedPath);
async function verified(path:string,digest:string){
  const b=await readFile(path);
  assert.equal(sha(b),digest,path);
  return JSON.parse(b.toString());
}
for(const [path,digest] of Object.entries(graded.manifest.sources)){
  assert.equal(sha(await readFile(path)),digest,path);
}
const data: TasteReplayDataset[]=await verified(capturePath,graded.manifest.capture);
const metadata=await verified(metadataPath,graded.manifest.metadata);
const opportunities=await verified(cataloguePath,graded.manifest.independentCatalogue);
const labels=await read(labelsPath),verifiedRatingsHash=sha(await readFile(labelsPath));
const independent=(await read(panelsPath)).panels.full;
const witnesses=await read(innerPath);
const snapshot=await read(snapshotPath);
type Rating={id:string,medium:TasteV2Medium,stars:number,at:string};
type Credit={id:string|number,role:string};
type Facts={credits?:Credit[],studios?:object[],networks?:object[],audience?:{score:number,votes:number,scale:number}};
type Root={id:string,title:string,medium:TasteV2Medium,features:TasteV2Features,facts:Facts,collections:string[]|null,overview:string|null};
type Output=Omit<Root,'facts'|'collections'>&{facts:{studios:object[];networks:object[]};family:string,credits:Credit[],
  voteAverage:number|null,voteCount:number,known:boolean,stars:number|null,ratingAt:string|null,withheld:boolean,
  raw:number|null,native:number|null,bothRemovals:number|null,confidence:number|null,donorNative:number|null,publicNative:number|null,
  exactDonorNative?:Record<string,number|null>,publicDonorNative?:Record<string,number|null>};
const labelsById=new Map<string,Rating>(labels.ratings.map((r:Rating)=>[r.id,r]));
const stored=new Map<string,number>(snapshot.personal.map((r:{id:string;stars:number})=>[r.id,r.stars]));
for(const [id,r] of labelsById)assert.equal(r.stars,stored.get(id),'The frozen direct rating has changed.');
assert.deepEqual(new Set(snapshot.history.map((r:{work:{id:string}})=>r.work.id)),new Set(data.flatMap(d=>d.history.map(r=>r.work.id))));
const votes=new Map<string,{score:number,votes:number}>((await read(publicPath)).rows.map((r:{id:string;score:number;votes:number})=>[r.id,r]));
const ablations=new Map<string,{base:number,bothRemovals:number}>();
for(const path of [moviesPath,showsPath]){
  const [receipt,...rows]=(await Bun.file(path).text()).trimEnd().split('\n').map(line=>JSON.parse(line));
  assert(receipt.type==='receipt' && receipt.labelHash===verifiedRatingsHash && rows.pop().type==='complete');
  for(const r of rows)ablations.set(r.id,r.scores);
}
assert.equal(ablations.size,labelsById.size);

// Use the same connected components as the franchise replay. A previously unseen
// collection member can connect to a rated sibling even when it was outside that sample.
function families(rows:{id:string;collections?:string[]|null;features:TasteV2Features}[]){
  const parent=new Map<string,string>();
  function root(i:string){while(parent.has(i))i=parent.get(i)!;return i;}
  for(const r of rows){
    for(const label of [...(r.collections??[]).map(x=>'collection:'+x),...(r.features.franchises??[]).map(x=>'feature:'+x.id)]){
      const a=root(r.id),b=root(label);
      if(a!==b)parent.set(a>b?a:b,a>b?b:a);
    }
  }
  return root;
}
const augment=creatorAugmenter(metadata);
const display:Partial<Record<TasteV2Medium,TasteV2Profile['display']>>={};
const results:Output[]=[];
for(const dataset of data){
  const medium=dataset.medium;
  if(medium!=='movie'&&medium!=='show')continue;
  const catalogue:Root[]=snapshot.rows.filter((r:Root)=>r.medium===medium);
  const original=dataset.history.map(r=>({...r,id:r.work.id,features:augment(r.work.id,r.features)}));
  const frozenFamily=families(original);
  const family=families([...original,...catalogue]);
  const history=mask(original,'all');
  const observed=new Set(original.map(r=>r.id));
  const familyIds=new Map<string,Set<string>>();
  const familyFolds=new Map<string,Set<number>>();
  for(const r of original){
    const k=family(r.id);
    if(!familyIds.has(k)){familyIds.set(k,new Set());familyFolds.set(k,new Set());}
    familyIds.get(k)!.add(r.id);
    familyFolds.get(k)!.add(workFold(frozenFamily(r.id)));
  }
  const tier=graded.runs.find((p:{medium:string;split:string;budget:string})=>p.medium===medium&&p.split==='franchise'&&p.budget==='all');
  const publicOut=new Map<string,number>();
  for(const t of tier.targets){
    assert.equal(t.cluster,frozenFamily(t.id));
    publicOut.set(t.id,t.scores.calibrated);
  }
  const nested=new Map<number,Map<string,number>>();
  for(const run of witnesses) if(run.medium===medium&&run.split==='franchise'&&run.budget==='all')
    nested.set(Number(run.group),new Map(run.points.map((p:{id:string;base:number})=>[p.id,p.base])));
  const fit=(excluded:Set<string>)=>trainTasteV2(medium,history.filter(r=>!excluded.has(r.work.id)),
    {stage:'calibrated',asOf:dataset.asOf,catalogue:opportunities[medium]});
  const full=fit(new Set());
  display[medium]=full.display;
  const featuresById=new Map(original.map(r=>[r.id,r.features]));
  for(const r of dataset.catalogue) featuresById.set(r.id,augment(r.id,r.features));
  const rawModels=new WeakMap<TasteV2Profile,TasteV2Profile>();
  const score=(model:TasteV2Profile,ablate:ReturnType<typeof buildScorers>,features:TasteV2Features)=>{
    const {score:native,confidence}=scoreTasteV2(model,features,{details:false});
    if(!rawModels.has(model))rawModels.set(model,{...model,display:undefined});
    const raw=scoreTasteV2(rawModels.get(model)!,features,{details:false}).score;
    return {native,raw,confidence,bothRemovals:ablate(features,native).bothRemovals};
  };
  const fullScorer=buildScorers(full);
  const basis=new Map<string,number|null>();
  for(const [k,ids] of familyIds){
    const rated=[...ids].filter(i=>labelsById.has(i));
    if(!rated.length)continue;
    if(ids.size===1){const i=rated[0];basis.set(i,independent[i].native);}
    else{
      const profile=fit(ids);
      for(const i of rated)basis.set(i,scoreTasteV2(profile,featuresById.get(i)!,{details:false}).score);
    }
  }
  const byFamilyPair=new Map<string,Map<string,number|null>>();
  const titles:Output[]=[];
  for(const root of catalogue){
    const {facts,collections:_,...row}=root;
    const {id}=row,known=observed.has(id),k=family(id),label=labelsById.get(id);
    const current=facts.audience;
    const publicRating=label&&votes.has(id)?votes.get(id):current?.scale===10?current:undefined;
    const out:Output={...row,family:k,known,stars:stored.get(id)??null,ratingAt:label?.at??null,
      facts:{studios:facts.studios??[],networks:facts.networks??[]},credits:facts.credits??[],
      voteAverage:publicRating?.score??null,voteCount:publicRating?.votes??0,withheld:false,
      native:null,raw:null,confidence:null,bothRemovals:null,publicNative:publicOut.get(id)??null,donorNative:basis.get(id)??null};
    if(label){
      const source=independent[id];
      assert.equal(label.stars,source.stars);
      assert.equal(ablations.get(id)!.base,source.native);
      Object.assign(out,{native:source.native,raw:source.raw,bothRemovals:ablations.get(id)!.bothRemovals,withheld:true});
    }else if(!known){ Object.assign(out,score(full,fullScorer,root.features)); }
    else if(option){
      const model=fit(new Set([id]));
      Object.assign(out,score(model,buildScorers(model),root.features),{withheld:true});
    }
    titles.push(out);
  }
  function team(r:Output){
    const roles=medium==='movie'?['Director']:['Creator','Showrunner'];
    return [...new Set(r.credits.filter(c=>roles.includes(c.role)&&/^\d+$/.test(String(c.id))).map(c=>String(c.id)))].sort().join('|');
  }
  const direct=titles.filter(r=>labelsById.has(r.id));
  const indexed=Map.groupBy(direct,team);
  for(const r of titles){
    const members=familyIds.get(r.family);
    if(!members||r.native===null||labelsById.has(r.id))continue;
    // Each exact-team precedent excludes both the donor's and the target's complete families.
    const key=team(r);
    const peers=key?(indexed.get(key)??[]).filter(j=>j.family!==r.family):[];
    if(peers.length&&peers.every(j=>j.stars!<=2.5)){
      const targetGenres=new Set(r.features.genres?.map(g=>g.id));
      r.exactDonorNative={};
      for(const j of peers){
        const genres=new Set(j.features.genres?.map(g=>g.id));
        const union=new Set([...targetGenres,...genres]);
        if(!union.size||2*[...genres].filter(g=>targetGenres.has(g)).length<union.size)continue;
        const pair=[r.family,j.family].sort().join('/');
        if(!byFamilyPair.has(pair)){
          const ids=new Set([...members,...familyIds.get(j.family)!]);
          const model=fit(ids);
          byFamilyPair.set(pair,new Map([...ids].filter(i=>labelsById.has(i)).map(i=>
            [i,scoreTasteV2(model,featuresById.get(i)!,{details:false}).score])));
        }
        r.exactDonorNative[j.id]=byFamilyPair.get(pair)!.get(j.id)??null;
      }
    }
    if(r.bothRemovals!==null&&r.bothRemovals<50&&r.native>=50&&r.voteAverage!==null&&r.voteAverage<6){
      const groups=familyFolds.get(r.family)!;
      r.publicDonorNative={};
      for(const donor of direct){
        if(donor.family===r.family)continue;
        const donorFold=workFold(frozenFamily(donor.id));
        if(groups.size===1){
          const [fold]=groups;
          r.publicDonorNative[donor.id]=donorFold===fold?donor.publicNative:nested.get(fold)?.get(donor.id)??null;
        }else{
          // A new catalogue relationship can join old folds. Omit a comparison if
          // the frozen cross-fit could have seen any of the target's family history.
          r.publicDonorNative[donor.id]=null;
        }
      }
    }
  }
  results.push(...titles);
  console.log(medium, titles.length,'roots;',titles.filter(r=>r.native!==null).length,'scored,',byFamilyPair.size,'joint exact-team fits.');
}
await writeFile(output,JSON.stringify({userId:snapshot.userId,revision:snapshot.revision,verifiedRatingsHash,
  trainedAt:Object.fromEntries(data.map(d=>[d.medium,d.asOf])),capturedAt:snapshot.asOf,display,rows:results}),
  {mode:0o600,flag:'wx'});
