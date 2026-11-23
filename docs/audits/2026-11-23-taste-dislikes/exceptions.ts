// Audits the native calibrated item scorer against the frozen private inputs. Prints aggregates only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {trainTasteV2,scoreTasteV2,type TasteV2Catalogue,type TasteV2Features,type TasteV2Observation} from '../../../src/lib/social/taste-v2';
import type {TasteReplayDataset} from '../../../scripts/taste-replay';

type Medium='movie'|'show';
type Row=TasteV2Observation;
type Literal=keyof TasteV2Features;
type Term=[Literal,string];
type Pair=[Term,Term];
type Meta={id:string;credits:{id:string;name:string;role:string}[]|null};
type Cell={trials:number;families:number;meanStars:number|null;low:number;high:number};
const [capturePath,metadataPath,cataloguePath,pairedPath]=process.argv.slice(2);
if(!pairedPath)throw Error('Pass capture, credits, independent catalogue and native calibrated pairs.');
const files=await Promise.all([capturePath,metadataPath,cataloguePath,pairedPath].map(path=>readFile(path)));
const [capture,metadata,catalogueByMedium,paired]=files.map(b=>JSON.parse(b.toString()));
for(const [resource,i] of [['capture',0],['metadata',1],['independentCatalogue',2]] as const)
  assert.equal(paired.manifest[resource],createHash('sha256').update(files[i]).digest('hex'));
assert.equal(paired.manifest.candidate,'calibrated');
const code=await readFile('src/lib/social/taste-v2.ts');
assert.equal(paired.manifest.sources['src/lib/social/taste-v2.ts'],createHash('sha256').update(code).digest('hex'));
const keys:Record<Medium,Pair[]>={
  movie:[[['studios','studio ghibli'],['tags','tmdb:210024']],[['directors','tmdb:525'],['genres','science fiction']],[['studios','pixar'],['genres','animation']]],
  show:[[['networks','hbo'],['genres','drama']]],
};
const credits=new Map((metadata as Meta[]).map(r=>[r.id,r.credits?.filter(c=>c.role==='Creator'&&/^\d+$/.test(c.id)) ?? []]));
function augmented(id:string,features:TasteV2Features) {
  const people=credits.get(id);
  return people?.length ? {...features,creators:people.map(c=>({id:'tmdb:'+c.id,name:c.name}))}:features;
}
function has(features:TasteV2Features,[dim,id]:Term) {
  return features[dim]?.some(x=>x.id===id)??false;
}
function cells(history:Row[],pair:Pair):Cell[] {
  const bins=Array.from({length:4},()=>({ratings:[] as number[], groups:new Set<string>()}));
  for(const row of history) {
    if(row.work.rating===null)continue;
    const bin=bins[Number(has(row.features,pair[0]))+2*Number(has(row.features,pair[1]))];
    bin.ratings.push(row.work.rating);
    bin.groups.add(row.features.franchises?.[0]?.id??row.work.id);
  }
  return bins.map(b=>({trials:b.ratings.length,families:b.groups.size,
    meanStars:b.ratings.length?Number((b.ratings.reduce((x,y)=>x+y,0)/b.ratings.length).toFixed(2)):null,
    low:b.ratings.filter(v=>v<=2.5).length,high:b.ratings.filter(v=>v>=4).length}));
}
function rowsForFit(history:Row[],ratings:boolean) {
  return history.flatMap(r=>{
    const w=r.work;
    if(ratings&&w.rating!==null)return [r];
    if(!(w.implicit || w.explicit || w.chosen || w.consumed || w.repeated || w.dropped || w.deliberateReturn))return [];
    return [{features:r.features,work:{...w,rating:null,lastRatedAt:null}}];
  });
}
const evidence=[];
for(const data of capture as TasteReplayDataset[]){
  if(data.medium!=='movie'&&data.medium!=='show')continue;
  const medium=data.medium;
  const rows:Row[]=data.history.map(r=>({...r,features:augmented(r.work.id,r.features)}));
  for(const ratings of [true,false]){
    const fit=rowsForFit(rows,ratings);
    const profile=trainTasteV2(medium,fit,{stage:'calibrated',catalogue:catalogueByMedium[medium] as TasteV2Catalogue,asOf:data.asOf});
    const stripped={...profile,pairs:[]};
    let changed=0, tested=0, abstained=0;
    for(const item of data.catalogue) {
      const f=augmented(item.id,item.features),a=scoreTasteV2(profile,f,{details:false}).score;
      const b=scoreTasteV2(stripped,f,{details:false}).score;
      if(a!==b) changed++;
      if(a===null)abstained++;
      tested++;
    }
    assert.equal(changed,0);
    const patterns=keys[medium].map(pair=>{
      const child=paired.sensitivities.find((p:{medium:string;first:string;second:string;budget:string})=>
        p.medium===medium&&p.first===pair[0][1]&&p.second===pair[1][1]&&p.budget===(ratings?'all':'0'));
      assert.ok(child);
      const c=cells(fit,pair);
      assert.deepEqual(c.map(b=>b.trials),child.support);
      const l=JSON.stringify(pair[1]),r=JSON.stringify(pair[0]);
      const interaction=profile.pairs.find(p=>p.left===l&&p.right===r);
      return {first:pair[0],second:pair[1],cells:c,anchors:child.n,v1:child.incumbent,graded:child.candidate,learnedOffset:interaction?.offset??null};
    });
    evidence.push({medium,ratings,activeGrading:Boolean(profile.display),trainedPairCount:profile.pairs.length,
      viewingReturnPairs:Object.keys(profile.retainedViewing?.returnWeights??{}).length,
      ratedRoots:rows.filter(r=>r.work.rating!==null).length,literalThemedRated:rows.filter(r=>r.work.rating!==null&&r.features.themes?.length).length,
      catalogue:tested,literalThemedCatalogue:data.catalogue.filter(r=>r.features.themes?.length).length,
      changedWhenDroppingPairs:changed,abstained,patterns});
  }
}
function pattern(theme:string,network:string) {return {themes:[{id:theme,name:theme}],networks:[{id:network,name:network}]};}
function make(id:string,rating:number,theme:string,network:string):Row {
  return {work:{id,kind:'show',medium:'show',rating,implicit:0,explicit:0,consumed:false,chosen:false,repeated:false},features:pattern(theme,network)};
}
const four=Array.from({length:20},(_,i)=>[
  make('joint-'+i,5,'theme-a','network-a'),make('theme-'+i,2.5,'theme-a','network-b'),
  make('network-'+i,2.5,'theme-b','network-a'),make('other-'+i,3.5,'theme-b','network-b'),
]).flat();
const target=pattern('theme-a','network-a');
const designs=[{name:'independent four cells',samples:four},
  {name:'always co-occur',samples:four.filter(r=>has(r.features,['themes','theme-a'])===has(r.features,['networks','network-a']))}];
const controls=designs.map(({name,samples})=>{
  const result={name,cells:cells(samples,[['networks','network-a'],['themes','theme-a']]),arms:{} as Record<string,unknown>};
  for(const stage of ['context','calibrated'] as const) {
    const model=trainTasteV2('show',samples,{stage});
    const offset=model.pairs.find(p=>p.left===JSON.stringify(['themes','theme-a'])&&p.right===JSON.stringify(['networks','network-a']))?.offset??null;
    const withPair=scoreTasteV2(model,target),without=scoreTasteV2({...model,pairs:[]},target).score;
    if(name==='always co-occur')assert.equal(offset,null);
    else {
      assert.ok(offset&&offset>0);
      if(stage==='context')assert.ok(withPair.score!>without!);
    }
    if(stage==='calibrated')assert.equal(withPair.score,without);
    result.arms[stage]={offset,activeGrading:Boolean(model.display),withPair:withPair.score,withoutPairs:without};
  }
  return result;
});
console.log(JSON.stringify({cellOrder:['neither','first only','second only','both'],profiles:evidence,networkThemeFixture:controls},null,2));
