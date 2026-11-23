// Read-only native component ablations. Keep the frozen, train-only display map.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {workFold,type TasteReplayDataset} from '../../../scripts/taste-replay';
import {scoreTasteV2,trainTasteV2,type TasteV2Medium,type TasteV2Observation,type TasteV2Features,type TasteV2Profile} from '../../../src/lib/social/taste-v2';
import {applyTasteV2Display} from '../../../src/lib/social/taste-v2-display';
import {scorerFromReference} from '../../../src/lib/social/taste-profile';

type Hold={id:string;stars:number;group:string;scores:{calibrated:number|null}};
type Receipt={medium:TasteV2Medium;budget:string;split:string;targets:Hold[]};
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export function creatorAugmenter(credits: {id:string; credits?: {id:number|string;name:string;role:string}[]}[]) {
  const cc=new Map<string,{id:string;name:string}[]>();
  for(const c of credits){
    const v=(c.credits??[]).filter(x=>x.role==='Creator'&&/^\d+$/.test(String(x.id))).map(x=>({id:'tmdb:'+x.id,name:x.name}));
    if(v.length)cc.set(c.id,v);
  }
  return (id:string,f:TasteV2Features)=>cc.has(id)?{...f,creators:cc.get(id)}:f;
}
const measures=['base','dropHigherSigned','centerDownwardContent','bothRemovals'] as const;
type Scored={stars:number;group:string;scores:Record<typeof measures[number],number|null>};
const clamp=(n:number,lo:number,hi:number)=>Math.min(Math.max(n,lo),hi);
const displayFit=(n:number)=>n<=50?n:n<=75?50+(n-50)*1.2:80+(n-75)*.8;
export function buildScorers(p:TasteV2Profile){
  const modelPersonal:TasteV2Profile={...p,stage:'personal'};
  const core=p.personalDimensions!;
  const rating:TasteV2Profile={...p,stage:'metadata',dimensions:core,pairs:[],affinities:p.affinities.flatMap(t=>core.includes(t.dimension)&&t.ratingFit!==undefined?[{...t,works:t.rated,affinity:t.ratingFit,confidence:t.ratingConfidence!}]:[])};
  // Keep all fitted keys. Setting their coefficients to zero preserves trait membership,
  // family weight, the rating intercept, and non-ordinal contributions at this item.
  const neutralContent:TasteV2Profile={...rating,ordinal:rating.ordinal&&{...rating.ordinal,coefficients:Object.fromEntries(Object.keys(rating.ordinal.coefficients).map(k=>[k,0]))}};
  const actions:TasteV2Profile={...p,stage:'actions',ratings:0,ordinal:undefined,pairs:[],affinities:p.affinities.flatMap(t=>t.actionFit===undefined?[]:[{...t,rated:0,affinity:t.actionFit,confidence:t.actionConfidence!}])};
  const signed=p.signed&&scorerFromReference(p.signed);
  const older=p.retainedViewing&&scorerFromReference(p.retainedViewing);
  const total=(result:ReturnType<typeof scoreTasteV2>)=>(result.base??50)+result.signals.reduce((s,t)=>s+t.contribution,0);
  function map(raw:number){return Math.round(applyTasteV2Display(p.display,Math.round(raw)));}
  return (f:TasteV2Features,expected:number|null):Scored['scores']=>{
    const base=scoreTasteV2(p,f,{details:false}).score;assert.equal(base,expected);
    const scores={base,dropHigherSigned:base,centerDownwardContent:base,bothRemovals:base};
    if(base===null || !p.ratings)return scores;
    const personal=scoreTasteV2(modelPersonal,f,{details:false}),reference=signed?.(f);
    if(personal.score===null)return scores;
    const fraction=reference?.score!=null&&p.works>=12 ? 1-Math.min(.5,p.ratings/100) : 0;
    const combine=(personalScore:number)=>map((1-fraction)*personalScore+fraction*(reference?.score??0));
    assert.equal(combine(personal.score),base);
    if(fraction && reference!.score!>personal.score) scores.dropHigherSigned=map(personal.score);
    scores.bothRemovals=scores.dropHigherSigned;
    const r=scoreTasteV2(rating,f);
    if(r.score===null || !rating.ordinal || r.base===undefined || r.base<=50)return scores;
    const without=scoreTasteV2(neutralContent,f);
    if(total(r)>=total(without)-1e-8)return scores;
    const a=scoreTasteV2(actions,f,{details:false}), retained=older?.(f);
    const action=retained?.score??a.score;
    let opinion=action===null ? 1 : p.ratings/(p.ratings+6);
    if(action!==null && p.ratings<=6 && r.confidence>=a.confidence)opinion=Math.max(opinion,.5);
    const margin=Math.max(0,6-personal.confidence/12);
    function fromRating(v:number){return Math.round(clamp(displayFit(opinion*v+(1-opinion)*(action??50)),margin,100-margin));}
    assert.equal(fromRating(r.score),personal.score);
    const recentered=Math.round(clamp(total(r)-(r.base-50),0,100));
    const adjusted=fromRating(recentered);
    scores.centerDownwardContent=combine(adjusted);
    scores.bothRemovals=fraction && reference!.score!>adjusted ? map(adjusted) : scores.centerDownwardContent;
    return scores;
  };
}
function groupFamilies(data:TasteReplayDataset){
  const parents=new Map<string,string>();
  const root=(id:string)=>{while(parents.has(id))id=parents.get(id)!;return id;};
  for(const r of data.history)for(const k of [...(r.collections??[]).map(v=>'collection:'+v),...(r.features.franchises??[]).map(f=>'feature:'+f.id)]){
    const a=root(r.work.id),b=root(k);if(a!==b)parents.set(a>b?a:b,a>b?b:a);
  }return root;
}
export function mask(rows:TasteV2Observation[],budget:string) {
  const [count,seed]=budget.split('#');
  const keep=new Set(rows.filter(r=>r.work.rating!==null).map(r=>({id:r.work.id,key:sha('solo:'+(seed??'1')+':'+r.work.id)})).sort((a,b)=>a.key.localeCompare(b.key)).slice(0,count==='all'?Infinity:Number(count)).map(r=>r.id));
  return rows.flatMap(r=>{const w=r.work;if(keep.has(w.id))return [{...r,audience:undefined}];if(!(w.implicit||w.explicit||w.consumed||w.chosen||w.repeated||w.dropped||w.deliberateReturn))return [];return [{...r,audience:undefined,credits:undefined,work:{...w,rating:null,lastRatedAt:null}}];});
}
function report(rows:Scored[],medium:string,split:string,budget:string) {
  const values=rows.filter(r=>r.scores.base!==null);
  const d=values.filter(r=>r.stars<=2.5), like=values.filter(r=>r.stars>=4),five=values.filter(r=>r.stars===5);
  const groups=Map.groupBy(values,r=>r.group);
  const output:Record<string,unknown>={};
  for(const name of measures){
    const score=(r:Scored)=>r.scores[name]!;
    const n=[0,0,0],w=[0,0,0];
    for(const set of groups.values())for(const a of set)for(const b of set){
      if(a.stars<=b.stars)continue;
      const win=score(a)>score(b)?1:score(a)===score(b)?.5:0;
      for(const i of [0,...(a.stars>=4&&b.stars<=3?[1]:[]),...(a.stars===5&&b.stars===3.5?[2]:[])]){n[i]++;w[i]+=win;}
    }
    output[name]={changed:values.filter(r=>score(r)!==r.scores.base).length,dislikedRed:d.filter(r=>score(r)<50).length,dislikedGreen:d.filter(r=>score(r)>=80).length,
      likedRed:like.filter(r=>score(r)<50).length,fiveLower:five.filter(r=>score(r)<r.scores.base!).length,fiveGreen:five.filter(r=>score(r)>=80).length,
      fiveOutOfGreen:five.filter(r=>score(r)<80&&r.scores.base!>=80).length,rank:w.map((v,i)=>n[i]?Number((v/n[i]*100).toFixed(2)):null)};
  }
  console.log(JSON.stringify({medium,split,budget,n:values.length,disliked:d.length,liked:like.length,fives:five.length,output}));
}
if(import.meta.main){
  const [capturePath,creditPath,opportunityPath,holdoutPath,datePath,option,privatePath]=process.argv.slice(2);
  if(!datePath)throw Error('Pass CAPTURE CREDITS CATALOGUE HOLDOUTS DATES.');
  assert(!option&&!privatePath || (option==='--earlier-only'||option==='--franchise-only')&&privatePath,
    'Use --earlier-only or --franchise-only and NEW_PRIVATE_JSONL to save the selected forecasts.');
  const evidence=await Bun.file(holdoutPath).json();
  async function input(path:string,key:string){const b=Buffer.from(await Bun.file(path).arrayBuffer());assert.equal(sha(b),evidence.manifest[key]);return JSON.parse(b.toString());}
  const [sets,credits,opportunities,dates]=await Promise.all([input(capturePath,'capture'),input(creditPath,'metadata'),input(opportunityPath,'independentCatalogue'),input(datePath,'dates')]);
  const savedRows:{medium:string; id:string; day?:string; split?:string; group?:string; stars:number; scores:Scored['scores']}[]=[];
  const augment=creatorAugmenter(credits);
  for(const data of sets as TasteReplayDataset[]){
    if(data.medium!=='movie'&&data.medium!=='show')continue;const medium=data.medium;
    const family=groupFamilies(data), features=new Map(data.history.map(r=>[r.work.id,augment(r.work.id,r.features)]));
    for(const r of data.catalogue)features.set(r.id,augment(r.id,r.features));
    const history=data.history.map(r=>({...r,features:augment(r.work.id,r.features)}));
    const selected=(r:Receipt)=>!option || (option==='--earlier-only' ? r.split==='rolling-day' :
      r.budget==='all'&&(r.split==='franchise'||r.split==='reassigned-franchise'));
    for(const run of (evidence.runs as Receipt[]).filter(r=>r.medium===medium&&selected(r))){
      const results:Scored[]=[];
      if(run.split==='rolling-day'){
        const prior:TasteV2Observation[]=[];
        const earlier=(dates as {id:string;medium:string;stars:number;at:string}[]).filter(d=>d.medium===medium&&features.has(d.id));
        const batches=Map.groupBy(earlier,d=>d.at.slice(0,10));
        const targets=new Map(run.targets.map(t=>[t.id,t]));
        for(const day of [...batches.keys()].sort()){
          if(prior.length>=25){
            const scorer=buildScorers(trainTasteV2(medium,prior,{stage:'calibrated',asOf:Date.parse(day+'T00:00:00Z')-1}));
            for(const d of batches.get(day)!){
              const t=targets.get(d.id)!;
              const scores=scorer(features.get(t.id)!,t.scores.calibrated);
              results.push({...t,scores});
              if(option)savedRows.push({medium,id:t.id,day,stars:t.stars,scores});
            }
          }
          for(const d of batches.get(day)!)prior.push({features:features.get(d.id)!,work:{id:d.id,kind:medium,medium,rating:d.stars,lastRatedAt:d.at,explicit:0,implicit:0,consumed:false,repeated:false,chosen:false}});
        }
      }else{
        const fold=(id:string)=>workFold(run.split==='work'?id:run.split==='franchise'?family(id):'coast-ordinal-eval-v1:'+family(id));
        for(let k=0;k<5;k++){
          const train=mask(history.filter(r=>fold(r.work.id)!==k),run.budget);
          const scorer=buildScorers(trainTasteV2(medium,train,{stage:'calibrated',catalogue:opportunities[medium],asOf:data.asOf}));
          for(const t of run.targets.filter(t=>Number(t.group)===k)){
            assert.equal(fold(t.id),k);
            const scores=scorer(features.get(t.id)!,t.scores.calibrated);
            results.push({...t,scores});
            if(option)savedRows.push({medium,id:t.id,split:run.split,group:t.group,stars:t.stars,scores});
          }
        }
      }
      assert.equal(results.length,run.targets.length);
      report(results,medium,run.split,run.budget);
    }
  }
  if(privatePath){
    assert(savedRows.length>0);
    const file=await open(privatePath,'wx',0o600);
    try{await file.writeFile(savedRows.map(r=>JSON.stringify(r)+'\n').join(''));}
    finally{await file.close();}
  }
}
