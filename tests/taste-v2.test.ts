import {expect,test} from 'bun:test';
import {scorePersonalTaste,trainPersonalTaste} from '../src/lib/social/taste-personal';
import {prepareTasteV2Catalogue,scoreTasteV2,trainTasteV2,type TasteV2Features,type TasteV2Observation} from '../src/lib/social/taste-v2';

const named=(id:string)=>[{id,name:id}];
const sciFi:TasteV2Features={genres:named('Sci-fi')};
const drama:TasteV2Features={genres:named('Drama')};
const studio=studioTraits('Ghibli');
function studioTraits(id:string):TasteV2Features {return {studios:named(id)};}

function work(id:string, rating:number|null, features:TasteV2Features, changes:Partial<TasteV2Observation['work']>={}):TasteV2Observation {
  return {work:{id,kind:'movie',medium:'movie',rating,implicit:0,explicit:0,consumed:false,chosen:false,repeated:false,...changes},features};
}

test('independent fits omit the root and its child evidence before learning any preferences',()=>{
  const rows=[work('other',1,drama),{...work('self',5,sciFi,{lastExperiencedAt:'2050-01-01'}),credits:[{features:{writers:named('Only here')},rating:5}]}];
  const clean=trainTasteV2('movie',rows.slice(0,1));
  const excluded=trainTasteV2('movie',rows,{excludeRoot:'self'});
  expect(excluded).toEqual(clean);
  expect(scoreTasteV2(excluded,sciFi).score).toBeNull();
  expect(scoreTasteV2(excluded,drama).score).toBeLessThan(50);
  expect(scoreTasteV2(excluded,{writers:named('Only here')}).score).toBeNull();
});

test('absolute preferences and confidence remain distinct with sparse ratings',()=>{
  const base=[work('one',5,sciFi),work('two',5,sciFi)];
  const target=(rows:TasteV2Observation[])=>scoreTasteV2(trainTasteV2('movie',rows),sciFi);
  const positive=target(base);
  const mixed=target([...base,work('other',3,sciFi)]);
  const contrary=target([...base,work('other',1,sciFi)]);
  expect(positive.score!).toBeGreaterThan(90);
  expect(positive.confidence).toBeLessThan(60);
  expect(mixed.score!).toBeLessThan(positive.score!);
  expect(contrary.score!).toBeLessThan(mixed.score!);
  expect(positive.score).toBe(target([...base,base[0]]).score);
  // No overlapping traits and an empty or watchlist-only profile are all unscorable.
  expect(scoreTasteV2(trainTasteV2('movie',base),{ageRatings:named('Unknown')}).score).toBeNull();
  expect(target([work('saved',null,sciFi,{implicit:1})]).score).toBeNull();
  expect(target([]).score).toBeNull();
});

test('root-level scope keeps observations, independence and roles distinct',()=>{
  const f={...sciFi,creators:named('Author'),franchises:named('Saga')};
  const rows=[work('a',5,f),work('b',4.5,f),work('c',1,drama),
    {...work('other',5,f),work:{...work('other',5,f).work,medium:'show' as const}}];
  const profile=trainTasteV2('movie',rows);
  expect(profile.works).toBe(3);
  expect(profile.affinities.find(t=>t.dimension==='creators')).toMatchObject({works:2,independent:1,rated:2});
  expect(profile.affinities.some(t=>t.dimension==='writers')).toBe(false);
});

test('actions-only estimates are independent of stars and retain genuine drops and deliberate returns',()=>{
  const rows=[work('fav',5,sciFi,{consumed:true,deliberateReturn:true}),
    work('again',3,sciFi,{consumed:true,repeated:true}),
    work('weak',1,drama,{consumed:true,dropped:true,watchHabits:{behind:1}})];
  const options={stage:'actions' as const,habits:true};
  const first=trainTasteV2('movie',rows,options);
  const swapped=trainTasteV2('movie',rows.map(row=>({...row,work:{...row.work,rating:5}})),options);
  expect(first).toEqual(swapped);
  expect(scoreTasteV2(first,sciFi).score!).toBeGreaterThan(scoreTasteV2(first,drama).score!);
  expect(first.affinities.find(t=>t.name==='Drama')!.drops).toBe(1);
});

test('an interaction requires independent joint and outside evidence for both traits',()=>{
  const same=Array.from({length:6},(_,i)=>work('same-'+i,5,{...sciFi,...studio}));
  const off=Array.from({length:8},(_,i)=>work('other-'+i,2,{...drama,...studioTraits('Other')}));
  expect(trainTasteV2('movie',[...same,...off],{stage:'context'}).pairs).toHaveLength(0);
});

test('fresh, serialised, batched and detailed score projections agree and explanations reconstruct points',()=>{
  const rows=Array.from({length:32},(_,i)=>work(String(i),i%3===0 ? 2 : i%3===1 ? 3.5 : 5,
    i%3===0?{...drama,...studio}:{...sciFi,cast:named(i%2?'A':'B')},{consumed:true}));
  const catalogue=prepareTasteV2Catalogue(rows.map(row=>row.features));
  for(const medium of ['movie','show'] as const) for(const stage of ['personal','balanced','contrast'] as const) {
    const data=rows.map(r=>({...r,work:{...r.work,kind:medium,medium}}));
    const model=trainTasteV2(medium,data,{catalogue,stage});
    const restored=JSON.parse(JSON.stringify(model));
    for(const target of [sciFi,drama,studio,{}]) {
      const rich=scoreTasteV2(model,target);
      const light=scoreTasteV2(restored,target,{details:false});
      expect(light.score).toBe(rich.score);
      expect(light.confidence).toBe(rich.confidence);
      expect(light.signals).toHaveLength(0);
      if(rich.score!==null) {
        expect(Math.round(rich.base!+rich.signals.reduce((s,t)=>s+t.contribution,0))).toBe(rich.score);
        expect(rich.confidence).toBeGreaterThanOrEqual(0);
        expect(rich.confidence).toBeLessThanOrEqual(100);
      }
    }
  }
});

test('signed references are independent of a self rating, friends, repeated imports and audience consensus',()=>{
  const rows=Array.from({length:24},(_,i)=>work('root-'+i,i%3===0?2:5,i%3===0?drama:sciFi,{consumed:true,chosen:true}));
  const target={...work('target',5,{...drama,...studio}),audience:{score:97,scale:100 as const,votes:100000}};
  const opts={stage:'balanced' as const,contextEvidence:false};
  const alone=trainTasteV2('movie',rows,opts);
  const omitted=trainTasteV2('movie',[...rows,rows[0],target],{...opts,excludeRoot:'target'});
  expect(omitted).toEqual(alone);
  expect(scoreTasteV2(omitted,drama)).toEqual(scoreTasteV2(alone,drama));
  const marked=rows.map(r=>({...r,audience:target.audience}));
  expect(trainTasteV2('movie',marked,opts)).toEqual(alone);
  expect(alone.signed?.selection).toBeUndefined();
  expect(alone.signed?.ratingWeights).toBeUndefined();
});

test('independent scoped interaction has effect only after observing both parent counterexamples',()=>{
  const pattern=(g:string,s:string)=>({genres:named(g),studios:named(s)});
  const examples=Array.from({length:12},(_,i)=>[
    work('joint-'+i,5,pattern('Animation','Indie')),
    work('genre-'+i,2.5,pattern('Animation','Other')),
    work('company-'+i,2.5,pattern('Drama','Indie')),
    work('neither-'+i,3.5,pattern('Drama','Other')),
  ]).flat();
  const p=trainTasteV2('movie',examples,{stage:'context'});
  const rich=scoreTasteV2(p,pattern('Animation','Indie'));
  expect(rich.signals.some(s=>s.dimension==='combination' && s.contribution>0)).toBe(true);
  expect(rich.score).toBe(scoreTasteV2(p,pattern('Animation','Indie'),{details:false}).score);
});

test('fresh cold known scores equal full forecasts after skipping only descriptive joint evidence',()=>{
  const rows=Array.from({length:40},(_,i)=>work('row-'+i,i%2===0?2:5,i%2===0?drama:sciFi,{consumed:true}));
  for(const stage of ['personal','balanced'] as const) {
    const opts={stage,excludeRoot:'row-0'};
    const profiles=[true,false].map(contextEvidence=>trainTasteV2('movie',rows,{...opts,contextEvidence}));
    expect(scoreTasteV2(profiles[0],sciFi)).toEqual(scoreTasteV2(profiles[1],sciFi));
  }
});

test('language, certificate and era can support a match without producing one by themselves',()=>{
  const context={languages:named('Spanish'),decades:named('1990s'),ageRatings:named('12')};
  const rows=Array.from({length:28},(_,i)=>work(String(i),i%3===0?2:5,{...context,...sciFi},{consumed:true}));
  const model=trainTasteV2('movie',rows,{stage:'balanced'});
  expect(scoreTasteV2(model,context).score).toBeNull();
  expect(scoreTasteV2(model,{...context,genres:named('Unknown classification')}).score).toBeNull();
  expect(scoreTasteV2(model,{...context,...sciFi}).score).not.toBeNull();
});

test('training-only display projection preserves neutrality, ordering and exact target omission',async()=>{
  const {applyTasteV2Display,fitTasteV2Display,tasteV2DisplayFolds}=await import('../src/lib/social/taste-v2-display');
  const rows=Array.from({length:108},(_,i)=>work('label-'+i,[1,2.5,3.5,4,4.5,5][i%6],{
    ...[sciFi,drama,{genres:named('Comedy')}][i%3],
    cast:named('Person '+i%5),franchises:named('Franchise '+i%11),
  },{consumed:true}));
  const scale=fitTasteV2Display(rows.map((r,i)=>({raw:55+(i%40),stars:r.work.rating!})));
  expect(scale).toBeDefined();
  expect([0,50,100].map(v=>applyTasteV2Display(scale,v))).toEqual([0,50,100]);
  const values=Array.from({length:101},(_,i)=>applyTasteV2Display(scale,i));
  expect(values).toEqual([...values].sort((a,b)=>a-b));
  expect(fitTasteV2Display([{raw:88,stars:5}])).toBeUndefined();
  const folds=tasteV2DisplayFolds(rows);
  expect(folds.get('label-0')).toBe(folds.get('label-11'));
  const id=rows[0].work.id;
  const opts={stage:'calibrated' as const,contextEvidence:false};
  const independent=trainTasteV2('movie',rows,{...opts,excludeRoot:id});
  const separate=trainTasteV2('movie',rows.slice(1),opts);
  expect(independent).toEqual(separate);
  expect(scoreTasteV2(independent,drama).score).toBe(scoreTasteV2(separate,drama,{details:false}).score);
});

test('music, games, books and comics match on their own credits without leaking other media', () => {
  const dimensions = {music:'artists',game:'developers',book:'writers',comic:'illustrators'} as const;
  for (const medium of ['music','game','book','comic'] as const) {
    const field = dimensions[medium];
    const liked = {[field]:named('Liked contributor')}, disliked = {[field]:named('Disliked contributor')};
    const history = Array.from({length:12}, (_, i) => work(String(i),i%2 ? 5 : 1,i%2 ? liked : disliked,
      {medium,consumed:true,chosen:true}));
    const full = trainPersonalTaste(medium, [...history,work('unrelated',5,disliked)]);
    expect(full.works).toBe(history.length);
    expect(scorePersonalTaste(full,liked).score).toBeGreaterThan(50);
    expect(scorePersonalTaste(full,disliked).score).toBeLessThan(50);
    expect(scorePersonalTaste(full,{cast:named('Liked contributor')}).score).toBeNull();
    expect(scorePersonalTaste(trainPersonalTaste(medium,[]),liked).score).toBeNull();
    const returned = history.slice(1,2).map(row => ({...row,work:{...row.work,rating:null,repeated:true,deliberateReturn:true}}));
    expect(scorePersonalTaste(trainPersonalTaste(medium,returned),liked).score).toBeGreaterThan(50);
  }
});
