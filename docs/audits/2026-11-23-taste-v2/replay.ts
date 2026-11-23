// Offline only. See README for CLI and private artifact handling.
import {createHash, randomBytes} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {workFold, trainReplayReference, type TasteReplayDataset} from '../../../scripts/taste-replay';
import {scorerFromReference, type TasteFeatures,type TasteReference} from '../../../src/lib/social/taste-profile';
import {trainTasteMedium} from '../../../src/lib/social/taste-training';
import {trainTasteV2, scoreTasteV2, prepareTasteV2Catalogue} from '../../../src/lib/social/taste-v2';

type Medium = 'movie' | 'show';
type Data = TasteReplayDataset & {medium:Medium};
type Row = Data['history'][number];
type Features = Parameters<typeof scoreTasteV2>[1];
type Options = NonNullable<Parameters<typeof trainTasteV2>[2]>;
type Target = {id:string;stars:number;group:string;cluster:string;genres:string[];scores:Record<string, number|null>};
type InputDate = {id:string;medium:Medium;stars:number;at:string};
type Credit = {id:string;name:string;role:string};
type Metadata = {id:string;title:string;credits:Credit[]|null};
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
async function contents(path:string) { const raw=await readFile(path); return {data:JSON.parse(raw.toString()),hash:sha(raw)}; }
const [mode, capturePath, datesPath, outPath, metadataPath, cataloguePath] = Bun.argv.slice(2);
if (!['quick','full','freeze','benchmark','pairs','anchors','gate','sparse-anchors','scale','dated-scale','graded'].includes(mode) || !capturePath || !datesPath || !outPath) {
  throw Error('Pass quick|full|freeze|benchmark|pairs|anchors|gate|sparse-anchors|scale|dated-scale|graded, a private capture, verified rating dates, a NEW private output, and optionally verified title metadata.');
}
const candidateStage=process.env.COAST_TASTE_REPLAY_STAGE??'balanced';
if(candidateStage!=='balanced'&&candidateStage!=='calibrated')throw Error('Unknown forecast policy');
const capture=await contents(capturePath);
const dateFile=await contents(datesPath);
const metadataFile=metadataPath ? await contents(metadataPath) : null;
const independentCatalogue=cataloguePath ? await contents(cataloguePath) : null;
const creditById = new Map<string,Credit[]>();
for(const row of (metadataFile?.data ?? []) as Metadata[]){
  const credits = (row.credits??[]).filter(c=>c.role==='Creator' && /^\d+$/.test(c.id));
  if(credits.length)creditById.set(row.id,credits);
}
function augmented(id:string, features:TasteFeatures):Features {
  const creators=creditById.get(id);
  return creators ? {...features,creators:creators.map(p=>({id:'tmdb:'+p.id,name:p.name}))} : features;
}
const sources=['src/lib/social/taste-v2.ts','src/lib/social/taste-v2-ordinal.ts','src/lib/social/taste-v2-display.ts','src/lib/social/taste-profile.ts','src/lib/social/taste-training.ts',
  'src/lib/social/taste-rating-model.ts','src/lib/social/taste-selection.ts','src/lib/social/taste-creators.ts',
  'scripts/taste-replay.ts','docs/audits/2026-11-23-taste-v2/replay.ts'];
const fileHashes=Object.fromEntries(await Promise.all(sources.map(async file=>[file,sha(await readFile(file))])));
const manifest={candidate:candidateStage,capture:capture.hash,dates:dateFile.hash,metadata:metadataFile?.hash??null,independentCatalogue:independentCatalogue?.hash??null,sources:fileHashes};
const output: {medium:Medium;split:string;budget:string;targets:Target[]}[]=[];
const salt=randomBytes(32).toString('hex');
type Point={stars:number;raw:number;v1:number};
const scales:{medium:Medium;split:string;group:string;train:Point[]}[]=[];
const forecasts: {key:string;medium:Medium;v1:number|null;v2:number|null}[]=[];
const sensitivities: {medium:Medium;first:string;second:string;budget:string;n:number;support:number[];incumbent:(number|null)[];candidate:(number|null)[]}[]=[];
const timings: {medium:Medium;case:string;ms:number;count:number}[]=[];
function franchiseOf(data:Data) {
  const parents=new Map<string,string>();
  function root(id:string) {let parent;while((parent=parents.get(id))!==undefined)id=parent;return id;}
  for(const r of data.history){
    const keys=[...(r.collections??[]).map(k=>'collection:'+k),...(r.features.franchises??[]).map(k=>'feature:'+k.id)];
    for(const key of keys){const a=root(r.work.id),b=root(key);if(a!==b)parents.set(a>b?a:b,a>b?b:a);}
  }
  return root;
}
function masked(rows:Row[],budget:number,seed:number):Row[] {
  const kept = new Set(rows.filter(r=>r.work.rating!==null)
    .map(r=>({id:r.work.id,key:sha('solo:'+seed+':'+r.work.id)}))
    .sort((a,b)=>a.key.localeCompare(b.key)).slice(0,budget).map(row=>row.id));
  return rows.flatMap(r=>{
    const w=r.work;
    if(kept.has(w.id)) return [{...r,audience:undefined}];
    if(!(w.implicit || w.explicit || w.chosen || w.consumed || w.repeated || w.dropped || w.deliberateReturn))return [];
    return [{...r,credits:undefined,audience:undefined,work:{...w,rating:null,lastRatedAt:null}}];
  });
}
type Arms=Record<string,Options>;
const stages:Arms={baseline:{stage:'baseline'},ordinal:{stage:'ordinal'},metadata:{stage:'metadata'},actions:{stage:'actions'},combined:{stage:'combined'},context:{stage:'context'},withoutOrdinal:{stage:'context',ordinal:false},withHabits:{stage:'context',habits:true}};
const finalArm:Arms={context:{stage:'context'},personal:{stage:'personal'},contrast:{stage:'contrast'},balanced:{stage:'balanced'}};
const core:NonNullable<Options['dimensions']>=['genres','tags','themes'];
const people:typeof core=[...core,'cast','directors','writers','creators'];
const companies:typeof core=[...people,'studios','networks','franchises'];
const familyArms:Arms={descriptive:{stage:'metadata',dimensions:core},people:{stage:'metadata',dimensions:people},
  companies:{stage:'metadata',dimensions:companies},noCreators:{stage:'metadata',dimensions:[...companies.filter(k=>k!=='creators'),'countries','languages','decades','ageRatings','composers','cinematographers']}};
function candidates(medium:Medium,rows:Row[],arms:Arms,asOf:number,catalogue?:Options['catalogue']) {
  const train=rows.map(r=>({...r,features:augmented(r.work.id,r.features)}));
  return Object.entries(arms).map(([name,opt])=>({name,profile:trainTasteV2(medium,train,{asOf,catalogue,...opt})}));
}
// Offline control for isolating which incumbent components survive a clean rebuild.
function controls(ref:TasteReference){
  return {signed:scorerFromReference({works:ref.works,dimensions:ref.dimensions}),
    noChoice:scorerFromReference({...ref,selection:undefined})};
}
function scoreControls(target:Target,f:TasteFeatures,variants:ReturnType<typeof controls>){
  const personal=target.scores.personal;
  for(const [name,scorer] of Object.entries(variants)){
    const anchor=scorer(f).score;
    target.scores[name]=anchor;
    for(const fraction of [.25,.5]){
      target.scores[name+String(fraction)]=anchor===null ? personal : personal===null ? anchor : Math.round((1-fraction)*anchor+fraction*personal);
    }
  }
}
for(const data of (capture.data as TasteReplayDataset[]).filter((d):d is Data=>d.medium==='movie'||d.medium==='show')){
  const medium=data.medium;
  // Frozen descriptive catalogue is common to all folds; no observation, rating, or selection flag is read.
  const catalogue:Options['catalogue']=independentCatalogue ? independentCatalogue.data[medium] : prepareTasteV2Catalogue(data.catalogue.map(r=>augmented(r.id,r.features)));
  if(!catalogue || !Number.isInteger(catalogue.size) || catalogue.size<1)throw Error('Missing eligible catalogue summary for '+medium);
  const features=new Map(data.history.map(r=>[r.work.id,r.features]));
  for(const r of data.catalogue)features.set(r.id,r.features);
  const known=new Set(data.history.map(r=>r.work.id));
  const parents=franchiseOf(data);
  function makeTarget(id:string,stars:number,group:string,cluster:string):Target{
    return {id,stars,group,cluster,genres:(features.get(id)?.genres??[]).map(g=>g.name),scores:{}};
  }
  if(mode==='pairs'){
    type Trait=[keyof TasteFeatures,string];
    const options: [Trait,Trait][] = medium==='movie' ? [[['studios','studio ghibli'],['tags','tmdb:210024']],
      [['directors','tmdb:525'],['genres','science fiction']],[['studios','pixar'],['genres','animation']]]
      : [[['networks','hbo'],['genres','drama']]];
    const contains=(f:TasteFeatures,[kind,id]:Trait)=>f[kind]?.some(x=>x.id===id)??false;
    const median=(a:number[])=>{a.sort((x,y)=>x-y);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
    for(const budget of [Infinity,0]){
      const train=masked(data.history,budget,1);
      const incumbent=scorerFromReference(await trainReplayReference(data,train,true));
      const [candidate]=candidates(medium,train,{candidate:{stage:candidateStage}},data.asOf,catalogue);
      for(const [first,second] of options){
        const terms=[first,second];
        const tags=terms.map(([kind,id])=>data.catalogue.flatMap(r=>r.features[kind]??[]).find(x=>x.id===id));
        if(tags.some(t=>!t))continue;
        const anchors=data.catalogue.filter(r=>!r.observed && contains(r.features,second));
        const support=[0,0,0,0];
        for(const r of train)if(r.work.rating!==null)support[Number(contains(r.features,first))+2*Number(contains(r.features,second))]++;
        const inc:number[][]=[[],[],[],[]], cand:number[][]=[[],[],[],[]];
        for(const r of anchors){
          const quad=[0,1,2,3].map(mask=>{
            const f={...r.features};
            terms.forEach(([kind,id],i)=>{
              f[kind]=(f[kind]??[]).filter(t=>t.id!==id);
              if(mask & (1<<i))f[kind]!.push(tags[i]!);
            });
            return [incumbent(f).score,scoreTasteV2(candidate.profile,augmented(r.id,f),{details:false}).score];
          });
          if(quad.some(cell=>cell.some(s=>s===null)))continue;
          quad.forEach(([v1,v2],i)=>{inc[i].push(v1!);cand[i].push(v2!);});
        }
        sensitivities.push({medium,first:first[1],second:second[1],budget:budget===0?'0':'all',n:inc[0].length,support,incumbent:inc.map(median),candidate:cand.map(median)});
      }
    }
    continue;
  }
  if(mode==='freeze' || mode==='benchmark'){
    const train=masked(data.history,Infinity,1);
    const v1=scorerFromReference(await trainReplayReference(data,train,true));
    const t=performance.now();
    const [candidate]=candidates(medium,train,{candidate:{stage:candidateStage}},data.asOf,catalogue);
    timings.push({medium,case:'full-fit',ms:performance.now()-t,count:train.length});
    const untouched=data.catalogue.filter(r=>!r.observed && !known.has(r.id));
    if(mode==='freeze')for(const r of untouched){
      const idKey=sha([salt,medium,r.id].join('/'));
      forecasts.push({key:idKey,medium,v1:v1(r.features).score,v2:scoreTasteV2(candidate.profile,augmented(r.id,r.features),{details:false}).score});
    }
    if(mode==='benchmark'){
      const augmentedTrain=train.map(r=>({...r,features:augmented(r.work.id,r.features)}));
      for(const count of [24,72]){
        const batch=untouched.slice(0,count).map(r=>augmented(r.id,r.features));
        const familiar=train.slice(0,count);
        const tick=performance.now();
        const knownResults=new Map<string,number|null>();
        for(const r of familiar){
          const ref=trainTasteV2(medium,augmentedTrain,{stage:candidateStage,excludeRoot:r.work.id,catalogue,asOf:data.asOf});
          knownResults.set(r.work.id,scoreTasteV2(ref,augmented(r.work.id,r.features),{details:false}).score);
        }
        timings.push({medium,case:'known-exact-cold',ms:performance.now()-tick,count});
        for(let repeat=0;repeat<11;repeat++){
          const a=performance.now();
          for(const f of batch)scoreTasteV2(candidate.profile,f,{details:false});
          timings.push({medium,case:'unseen-warm',ms:performance.now()-a,count});
          const b=performance.now();
          for(const r of familiar)if(!knownResults.has(r.work.id))throw Error('Missing warmed independent result');
          timings.push({medium,case:'known-warm',ms:performance.now()-b,count});
        }
      }
    }
    continue;
  }
  const rated=data.history.filter(r=>r.work.rating!==null);
  for(const split of (mode==='dated-scale'?[]:mode==='quick'||mode==='sparse-anchors'?['work']:['work','franchise','reassigned-franchise'])){
    const assign=(id:string)=>split==='work'?workFold(id):split==='franchise'?workFold(parents(id)):workFold('coast-ordinal-eval-v1:'+parents(id));
    const innerCache=new Map<string,Map<number,Point[]>>();
    const budgets=mode==='scale'?[Infinity]:mode==='anchors'?[Infinity,0]:mode==='gate'?[Infinity]:split==='work'&&(mode==='full'||mode==='graded'||mode==='sparse-anchors')?[Infinity,0,2,10,50]:[Infinity,0];
    for(const budget of budgets)for(const seed of budget>0&&Number.isFinite(budget)?[1,2,3]:[1]){
      const budgetName=Number.isFinite(budget)?String(budget)+(budget?'#'+seed:''):'all';
      const targets:Target[]=[];
      for(let k=0;k<5;k++){
        const train=masked(data.history.filter(r=>assign(r.work.id)!==k),budget,seed);
        const ref=await trainReplayReference(data,train,true);
        const incumbent=scorerFromReference(ref);
        const variants=mode==='anchors'||mode==='sparse-anchors'?controls(ref):undefined;
        const arms=budget===0 ? {actions:stages.actions,noCatalogue:{stage:'actions',catalogue:undefined} as Options,personalNoCatalogue:{stage:'personal',catalogue:undefined} as Options,...finalArm}
          : budget===Infinity&&split==='work' ? {...stages,...familyArms,...finalArm}: finalArm;
        const models=candidates(medium,train,mode==='graded'?{balanced:{stage:'balanced'},calibrated:{stage:'calibrated'}}:mode==='scale'?{balanced:{stage:'balanced'}}:arms,data.asOf,catalogue);
        if(mode==='scale'){
          const evidence:Point[]=[];
          for(let inner=0;inner<5;inner++){
            if(inner===k)continue;
            const key=[k,inner].sort().join('/');
            if(!innerCache.has(key)){
              const kept=masked(data.history.filter(r=>![k,inner].includes(assign(r.work.id))),Infinity,1);
              const ref=await trainReplayReference(data,kept,true);
              const old=scorerFromReference(ref);
              const [model]=candidates(medium,kept,{candidate:{stage:candidateStage}},data.asOf,catalogue);
              const byFold=new Map<number,Point[]>([[k,[]],[inner,[]]]);
              for(const row of rated){
                const id=row.work.id,group=assign(id),out=byFold.get(group);if(!out)continue;
                const f=features.get(id)!,raw=scoreTasteV2(model.profile,augmented(id,f),{details:false}).score,v1=old(f).score;
                if(raw!==null && v1!==null)out.push({stars:row.work.rating!,raw,v1});
              }
              innerCache.set(key,byFold);
            }
            evidence.push(...innerCache.get(key)!.get(inner)!);
          }
          scales.push({medium,split,group:String(k),train:evidence});
        }
        for(const r of rated.filter(r=>assign(r.work.id)===k)){
          const id=r.work.id, f=features.get(id)??{}, fresh=augmented(id,f);
          const target=makeTarget(id,r.work.rating!,String(k),parents(id));
          target.scores.v1=incumbent(f).score;
          for(const m of models)target.scores[m.name]=scoreTasteV2(m.profile,fresh,{details:false}).score;
          if(variants)scoreControls(target,f,variants);
          targets.push(target);
        }
      }
      output.push({medium,split,budget:budgetName,targets});
      console.error(medium,split,budgetName,targets.length);
    }
  }
  if(mode==='quick'||mode==='gate'||mode==='sparse-anchors') continue;
  const dates=(dateFile.data as InputDate[]).filter(r=>r.medium===medium && features.has(r.id));
  const dateIndex=new Set<string>();
  const days=new Map<string,InputDate[]>();
  for(const d of dates){
    if(dateIndex.has(d.id))throw Error('Duplicate verified rating root');
    dateIndex.add(d.id);const day=new Date(d.at).toISOString().slice(0,10);
    if(!days.has(day))days.set(day,[]);
    days.get(day)!.push(d);
  }
  const prior:Row[]=[],targets:Target[]=[], earlierForecasts:Point[]=[];
  for(const day of [...days.keys()].sort()){
    const held=days.get(day)!;
    if(prior.length>=25){
      const fit=trainTasteMedium(medium,prior.length,null,Date.parse(day+'T00:00:00Z')-1);
      for(const r of prior)fit.add(r);
      const ref=(await fit.finish()).reference;
      const incumbent=scorerFromReference(ref);
      const variants=mode==='anchors'||mode==='sparse-anchors'?controls(ref):undefined;
      const models=candidates(medium,prior,mode==='graded'?{balanced:{stage:'balanced'},calibrated:{stage:'calibrated'}}:{ordinal:stages.ordinal,metadata:stages.metadata,...finalArm},Date.parse(day+'T00:00:00Z')-1);
      if(mode==='scale')scales.push({medium,split:'rolling-day',group:day,train:[...earlierForecasts]});
      if(mode==='dated-scale'){
        // All underlying opinions here precede the outer forecast. Assign an
        // entire prior rating day to one inner partition, including import batches.
        const cut=Date.parse(day+'T00:00:00Z')-1;
        const innerFold=(r:Row)=>workFold('dated-scale:'+String(r.work.lastRatedAt).slice(0,10))%3;
        const inner:Point[]=[];
        for(let k=0;k<3;k++){
          const retained=prior.filter(r=>innerFold(r)!==k),hidden=prior.filter(r=>innerFold(r)===k);
          if(retained.length<12||!hidden.length)continue;
          const baseline=trainTasteMedium(medium,retained.length,null,cut);for(const r of retained)baseline.add(r);
          const old=scorerFromReference((await baseline.finish()).reference);
          const [model]=candidates(medium,retained,{balanced:{stage:'balanced'}},cut);
          for(const r of hidden){
            const f=r.features,prev=old(f).score,raw=scoreTasteV2(model.profile,augmented(r.work.id,f),{details:false}).score;
            if(raw!==null && prev!==null)inner.push({stars:r.work.rating!,raw,v1:prev});
          }
        }
        scales.push({medium,split:'rolling-day',group:day,train:inner});
      }
      for(const r of held){
        const f=features.get(r.id)!;
        const target=makeTarget(r.id,r.stars,day,day);
        target.scores.v1=incumbent(f).score;
        for(const m of models)target.scores[m.name]=scoreTasteV2(m.profile,augmented(r.id,f),{details:false}).score;
        if(variants)scoreControls(target,f,variants);
        if(mode==='scale' && target.scores.balanced!==null && target.scores.v1!==null)earlierForecasts.push({raw:target.scores.balanced,v1:target.scores.v1,stars:r.stars});
        targets.push(target);
      }
    }
    for(const r of held) prior.push({features:features.get(r.id)!,work:{id:r.id,kind:medium,medium,rating:r.stars,
      lastRatedAt:r.at,explicit:0,implicit:0,consumed:false,repeated:false,chosen:false}});
  }
  output.push({medium,split:'rolling-day',budget:'dated ratings only',targets});
  console.error(medium,'rolling-day',targets.length);
}
const file=mode==='freeze'?{version:2,sealed:new Date().toISOString(),manifest,salt,entries:forecasts}
  :mode==='benchmark'?{version:2,manifest,timings}:mode==='pairs'?{version:2,manifest,sensitivities}:{version:2,manifest,runs:output,...(['scale','dated-scale'].includes(mode)?{scales}:{})};
await writeFile(outPath,JSON.stringify(file),{flag:'wx',mode:0o600});
