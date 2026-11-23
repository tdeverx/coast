// Reconstruct the exact whole-work folds. Console output contains the viewer's ratings.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {workFold,type TasteReplayDataset} from '../../../scripts/taste-replay';
import {trainTasteV2,scoreTasteV2,type TasteV2Catalogue,type TasteV2Features,type TasteV2Medium,type TasteV2Profile} from '../../../src/lib/social/taste-v2';
import {orderedValue} from '../../../src/lib/social/taste-v2-ordinal';
import {scorerFromReference} from '../../../src/lib/social/taste-profile';

const [captureFile,creditFile,catalogueFile,receiptFile]=process.argv.slice(2);
if(!receiptFile) throw Error('Pass the frozen capture, verified credits, independent catalogue counts and graded holdout receipt.');
type Target={id:string;stars:number;group:string;scores:Record<string,number|null>};
const receipt=await Bun.file(receiptFile).json() as {manifest:Record<string,string>;runs:{medium:string;split:string;budget:string;targets:Target[]}[]};
async function verified<T>(path:string,key:string):Promise<T>{
  const bytes=await Bun.file(path).arrayBuffer();
  assert.equal(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),receipt.manifest[key],'Changed '+key);
  return JSON.parse(new TextDecoder().decode(bytes));
}
type Info={id:string;title:string;credits:{id:string;role:string;name:string}[]|null};
const [capture,metadata,catalogue]=await Promise.all([
  verified<TasteReplayDataset[]>(captureFile,'capture'),verified<Info[]>(creditFile,'metadata'),
  verified<Record<TasteV2Medium,TasteV2Catalogue>>(catalogueFile,'independentCatalogue')
]);
const info=new Map(metadata.map(m=>[m.id,m]));
const round=(n:number)=>Math.round(n*100)/100;
function augmented(id:string,f:TasteV2Features):TasteV2Features {
  const creators=info.get(id)?.credits?.filter(c=>c.role==='Creator' && /^\d+$/.test(c.id)).map(c=>({id:'tmdb:'+c.id,name:c.name}));
  return creators?.length?{...f,creators}:f;
}
function keyTerms(features:TasteV2Features) {
  const terms=new Map<string,string>();
  for(const dimension of ['genres','tags','themes','directors','writers','creators','cast','franchises','studios','networks'] as const)
    for(const value of features[dimension]??[]) terms.set(JSON.stringify([dimension,value.id]),value.name);
  return terms;
}
function components(model:TasteV2Profile) {
  const core=model.personalDimensions!;
  const rated:TasteV2Profile={...model,stage:'metadata',dimensions:core,pairs:[],affinities:model.affinities.flatMap(t=>
    core.includes(t.dimension)&&t.ratingFit!==undefined?[{...t,works:t.rated,affinity:t.ratingFit,confidence:t.ratingConfidence!}]:[])};
  const actions:TasteV2Profile={...model,stage:'actions',ratings:0,ordinal:undefined,pairs:[],
    affinities:model.affinities.flatMap(t=>t.actionFit!==undefined?[{...t,rated:0,affinity:t.actionFit,confidence:t.actionConfidence!}]:[])};
  const retained=model.retainedViewing?scorerFromReference(model.retainedViewing):null;
  const signed=scorerFromReference(model.signed!,true);
  const personal:TasteV2Profile={...model,stage:'personal'};
  const raw:TasteV2Profile={...model,stage:'balanced',display:undefined};
  return (features:TasteV2Features)=>{
    const f=scoreTasteV2(model,features);
    if(f.score===null) return null;
    const rating=scoreTasteV2(rated,features);
    const signedFit=signed(features);
    const action=retained?.(features).score??scoreTasteV2(actions,features).score;
    const top=(sign:1|-1)=>f.signals.filter(t=>sign*t.contribution>0).sort((a,b)=>sign*(b.contribution-a.contribution)).slice(0,5)
      .map(t=>({name:t.name,dimension:t.dimension,points:round(t.contribution),rated:t.rated,independent:t.independent}));
    return {score:f.score,raw:scoreTasteV2(raw,features).score,personal:scoreTasteV2(personal,features).score,signed:signedFit.score,
      rating:rating.score,behaviour:action,ordinalAtZero:round(orderedValue(model.ordinal!,0)),ratingBase:round(rating.base??0),
      userRated:model.ratings,displayBase:round(f.base!),confidence:f.confidence,
      plus:round(f.signals.reduce((sum,s)=>sum+Math.max(0,s.contribution),0)),minus:round(f.signals.reduce((sum,s)=>sum+Math.min(0,s.contribution),0)),
      positive:top(1),negative:top(-1)};
  };
}
for(const data of capture){
  if(data.medium!=='movie'&&data.medium!=='show')continue;
  const medium=data.medium;
  const targets=receipt.runs.find(r=>r.medium===medium&&r.split==='work'&&r.budget==='all')!.targets;
  const features=new Map(data.history.map(r=>[r.work.id,augmented(r.work.id,r.features)]));
  for(const r of data.catalogue)features.set(r.id,augmented(r.id,r.features));
  for(let fold=0;fold<5;fold++){
    const train=data.history.filter(r=>workFold(r.work.id)!==fold).filter(({work:w})=>
      w.rating!==null||w.implicit||w.explicit||w.chosen||w.consumed||w.repeated||w.dropped||w.deliberateReturn)
      .map(r=>({...r,features:augmented(r.work.id,r.features),audience:undefined,credits:r.work.rating===null?undefined:r.credits}));
    const model=trainTasteV2(medium,train,{stage:'calibrated',asOf:data.asOf,catalogue:catalogue[medium]});
    const explain=components(model);
    const held=targets.filter(t=>workFold(t.id)===fold);
    const df=new Map<string,number>();
    for(const row of train)for(const k of keyTerms(row.features).keys())df.set(k,(df.get(k)??0)+1);
    const idf=(k:string)=>Math.log1p((train.length+1)/(1+(df.get(k)??0)));
    const favour=held.filter(r=>r.stars===5).map(t=>({t,terms:keyTerms(features.get(t.id)!)}));
    for(const t of held){
      const f=features.get(t.id)!;
      const actual=explain(f);
      assert.equal(actual?.score??null,t.scores.calibrated);
      if(t.stars>2.5)continue;
      const terms=keyTerms(f);
      // Compare to the most similar five-star target scored by this exact fitted model.
      const close=favour.map(({t,terms:other})=>{
        const shared=[...terms.keys()].filter(k=>other.has(k));
        const union=new Set([...terms.keys(),...other.keys()]);
        const mass=(keys:Iterable<string>)=>[...keys].reduce((s,k)=>s+idf(k),0);
        return {t,sim:mass(shared)/Math.max(1,mass(union)),shared:shared.sort((a,b)=>idf(b)-idf(a)).slice(0,10).map(k=>terms.get(k))};
      }).sort((a,b)=>b.sim-a.sim||a.t.id.localeCompare(b.t.id))[0];
      const negativeTraining=Array.from(terms,([k,label])=>{
        const votes=train.filter(r=>r.work.rating!==null && keyTerms(r.features).has(k)).map(r=>r.work.rating!);
        return {label,ratings:votes.length,disliked:votes.filter(v=>v<=2.5).length,liked:votes.filter(v=>v>=4).length};
      }).filter(t=>t.disliked>=2 && t.disliked>t.ratings/2);
      const mask=[...terms].map(([key,label])=>{
        const [dimension,id]=JSON.parse(key) as [keyof TasteV2Features,string];
        const without=scoreTasteV2(model,{...f,[dimension]:(f[dimension]??[]).filter(x=>x.id!==id)},{details:false}).score;
        return {dimension,label,delta:without===null||actual===null?null:actual.score-without};
      });
      console.log(JSON.stringify({medium,fold,matchingPairs:model.pairs.filter(pair=>terms.has(pair.left)&&terms.has(pair.right)).map(pair=>[terms.get(pair.left),terms.get(pair.right),round(pair.offset)]),withoutBothDescriptive:scoreTasteV2(model,{...f,genres:[],tags:[],themes:[]},{details:false}).score,mask,title:info.get(t.id)?.title,stars:t.stars,...actual,negativeTraining,
        comparison:close&&{title:info.get(close.t.id)?.title,score:close.t.scores.calibrated,shared:close.shared,similarity:round(close.sim)}}));
    }
  }
}
