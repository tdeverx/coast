import {test,expect} from 'bun:test';
import {buildTasteProfile,scoreTaste,compileTasteScorer,prepareTasteReference,scorerFromReference,createTasteAccumulator,decodeTasteAffinities,tasteDimensions,namedFeatures,
 type TasteFeatures,type TasteWorkEvidence} from '../src/lib/social/taste-profile';
import {unknownActivityDate} from '../src/lib/social/model';
import {createTasteRatingTrainer,tasteRatingAdjustment} from '../src/lib/social/taste-rating-model';

const genres=namedFeatures(['Drama']),cast=namedFeatures(['Actor']),tags=namedFeatures(['Space exploration']);
const watched:TasteWorkEvidence={rating:null,explicit:0,implicit:3,consumed:true,repeated:false};
const favourite:TasteWorkEvidence={rating:null,explicit:5,implicit:0,consumed:false,repeated:false};
const item=(count:number,evidence:TasteWorkEvidence,features:TasteFeatures)=>{
 const profile=createTasteAccumulator();
 for(let i=0;i<count;i++)profile.add(evidence,features);
 return profile.snapshot();
};

test('visible overlap counts each work once and preserves the strongest explicit dislike regardless of input order',()=>{
 const rows=[3,-6,-5,5].map(weight=>({id:'a',weight,features:{genres}}));
 const a=buildTasteProfile(rows),b=buildTasteProfile(rows.toReversed());
 expect(a).toEqual(b);expect(a.works).toBe(1);
 expect(a.dimensions.genres![0]).toMatchObject({samples:1,value:-0.4});
});

test('a common genre cannot acquire a match by also appearing as a tag, theme, language and country',()=>{
 const features={genres,tags:namedFeatures(['DRAMA']),themes:namedFeatures(['Drama']),languages:namedFeatures(['English']),countries:namedFeatures(['United States'])};
 const profile=item(100,favourite,features);
 expect(scoreTaste(profile,features)).toMatchObject({score:null,confidence:0,reasons:[]});
 expect(scoreTaste(profile,{})).toMatchObject({score:null,confidence:0,matches:0});
});

test('one work has one vote per feature, a single title cannot support a score, and correlated rich metadata cannot inflate confidence',()=>{
 const rich=Object.fromEntries(tasteDimensions.map(dimension=>[dimension,[{id:dimension,name:dimension},{id:dimension,name:dimension}]]));
 const one=item(1,favourite,rich);
 expect(one.dimensions.genres![0][3]).toBe(1);
 expect(one.dimensions.cast).toBeUndefined();
 expect(scoreTaste(one,rich).score).toBeNull();
 const two=scoreTaste(item(2,favourite,rich),rich),implicit=scoreTaste(item(2,watched,rich),rich);
 expect(two.score).toBeGreaterThan(50);expect(two.confidence).toBeLessThanOrEqual(34);
 expect(implicit.confidence).toBeLessThanOrEqual(20);
 expect(two.reasons.length).toBeLessThanOrEqual(3);
});

test('explicit ratings supersede repeats, calibrate to a supported personal median, and retain their raw like rate',()=>{
 const rate=(count:number,median:number,rating:number)=>{
  const acc=createTasteAccumulator({count,median});
  for(let i=0;i<8;i++)acc.add({...watched,rating,explicit:5,repeated:true},{cast});
  return acc.snapshot();
 };
 const liked=rate(20,2,3.5),generous=rate(20,5,3.5),sparse=rate(1,5,3.5);
 expect(scoreTaste(liked,{cast}).score!).toBeGreaterThan(scoreTaste(generous,{cast}).score!);
 expect(sparse.dimensions.cast![0][2]).toBe(rate(0,2.75,3.5).dimensions.cast![0][2]);
 expect(decodeTasteAffinities(generous.dimensions.cast!)[0]).toMatchObject({explicitSamples:8,positiveFeedbackSamples:8,consumedSamples:8,repeatedSamples:8});
 const disliked=rate(20,5,0.5),result=scoreTaste(disliked,{cast});
 expect(disliked).toMatchObject({works:8,explicitWorks:8,inferredWorks:0,consumedWorks:8,repeatedWorks:8});
 expect(result.score!).toBeLessThan(40);
 expect(result.reasons[0]).toMatchObject({name:'Actor',direction:'negative',samples:8});
 expect(decodeTasteAffinities(disliked.dimensions.cast!)[0].positiveFeedbackSamples).toBe(0);
});

test('frequency measures distinct consumed works across the whole medium and deliberate returns strengthen it',()=>{
 const range=(played:number,total:number,repeats:number)=>{
  const acc=createTasteAccumulator();
  // Even without metadata the other watched works remain in the history denominator.
  for(let i=0;i<total;i++)acc.add({...watched,repeated:i<repeats},i<played?{cast,genres}:{});
  return acc.snapshot();
 };
 const occasional=range(30,100,0),frequent=range(90,100,0),returning=range(90,100,60);
 expect(occasional).toMatchObject({works:100,worksWithSignals:30,consumedWorks:100,repeatedWorks:0});
 const actor=(profile:typeof frequent)=>decodeTasteAffinities(profile.dimensions.cast!)[0];
 expect(actor(occasional)).toMatchObject({consumedSamples:30,repeatedSamples:0,explicitSamples:0});
 expect(actor(returning)).toMatchObject({consumedSamples:90,repeatedSamples:60,positiveFeedbackSamples:0});
 expect(actor(frequent).value-actor(occasional).value).toBeGreaterThan(0.30);
 expect(actor(returning).value).toBeGreaterThan(actor(frequent).value);
 expect(actor(occasional).value).toBeGreaterThan(actor(range(30,1000,0)).value);
 expect(scoreTaste(frequent,{cast}).score!).toBeGreaterThan(scoreTaste(occasional,{cast}).score!);
 expect(scoreTaste(frequent,{cast}).reasons[0]).toMatchObject({dimension:'cast',name:'Actor',direction:'positive'});
 expect(scoreTaste(frequent,{cast:[...cast,...namedFeatures(Array.from({length:50},(_,i)=>'Other '+i))]}).confidence)
  .toBeLessThan(scoreTaste(frequent,{cast}).confidence);
 const saved=item(15,favourite,{cast});
 expect(saved.consumedWorks).toBe(0);expect(actor(saved)).toMatchObject({consumedSamples:0,explicitSamples:15,positiveFeedbackSamples:15});
});

test('watched titles credited to an explicit opinion cannot add a second inferred observation',()=>{
 const sample=(overlap:boolean)=>{
  const acc=createTasteAccumulator(),features={directors:cast};
  for(let i=0;i<4;i++)acc.add({...favourite,rating:4,consumed:overlap},features);
  for(let i=0;i<30;i++){
   const played=!overlap&&i<4;
   acc.add({...watched,consumed:played,implicit:played?3:1},features);
  }
  return acc.snapshot();
 };
 const rated={...favourite,rating:1},ratedAndReplayed={...rated,implicit:4,consumed:true,repeated:true};
 const withoutPlays=item(8,rated,{directors:cast}),withPlays=item(8,ratedAndReplayed,{directors:cast});
 expect(withPlays.dimensions.directors![0][2]).toBe(withoutPlays.dimensions.directors![0][2]);
 expect(withPlays.dimensions.directors![0][8]).toBe(8);
 const overlapping=sample(true),independent=sample(false);
 expect(overlapping).toMatchObject({works:34,explicitWorks:4,inferredWorks:30,consumedWorks:4});
 expect(independent).toMatchObject({works:34,explicitWorks:4,inferredWorks:30,consumedWorks:4});
 expect(overlapping.dimensions.directors![0][10]).toBe(0);
 expect(independent.dimensions.directors![0][10]).toBe(4);
 const overlapSupport=prepareTasteReference(overlapping).dimensions.directors!.actor[5];
 const independentSupport=prepareTasteReference(independent).dimensions.directors!.actor[5];
 expect(overlapSupport).toBeLessThan(independentSupport);
});

test('balanced opposing opinions yield a mixed explanation and sparse unknown metadata carries no dislike',()=>{
 const acc=createTasteAccumulator();
 for(let i=0;i<20;i++)acc.add({...favourite,rating:i%2?5:0.5},{directors:cast,tags});
 const profile=acc.snapshot(),score=compileTasteScorer(profile);
 expect(score({directors:cast})).toMatchObject({score:50,reasons:[{direction:'mixed',samples:20}]});
 expect(score({artists:cast}).score).toBeNull();
 const covered=score({directors:cast,tags}),partial=score({directors:cast,tags:namedFeatures(['Unknown'])});
 expect(partial.confidence).toBeLessThan(covered.confidence);
 expect(partial.score).toBe(50);
});

test('game mode, decade and unverified artist names remain context, while verified creators can support a match',()=>{
 const artist=(id:string)=>[{id,name:'The Artist'}];
 const modes=namedFeatures(['Single player']),decades=namedFeatures(['1990s']);
 const ambiguous={mechanics:modes,perspectives:namedFeatures(['First person']),decades,artists:artist('artist-name:the artist')};
 expect(scoreTaste(item(40,watched,ambiguous),ambiguous).score).toBeNull();
 for(const dimension of ['artists','composers','cinematographers'] as const){
  const feature={[dimension]:artist('verified:123')};
  expect(scoreTaste(item(12,watched,feature),feature).score!).toBeGreaterThan(50);
 }
});

test('multiple roles by one person preserve distinct affinities without multiplying credit or explanations',()=>{
 const credit=namedFeatures(['A Creator']),roles={directors:credit,writers:credit,composers:credit,cast:credit};
 const profile=item(20,favourite,roles);
 const single=scoreTaste(profile,{directors:credit}),many=scoreTaste(profile,roles);
 expect(many.score!).toBeLessThanOrEqual(single.score!);
 expect(many.confidence).toBeLessThanOrEqual(single.confidence);
 expect(many.reasons.map(reason=>reason.name)).toEqual(['A Creator']);
});

test('a frequent unverified artist name cannot reverse a match for a verified collaborator',()=>{
 const known={id:'artist:known',name:'Known'};
 const ambiguous={id:'artist-name:alex',name:'Alex'};
 const profile=createTasteAccumulator();
 for(let i=0;i<100;i++)profile.add({...favourite,rating:5},{artists:[ambiguous]});
 for(let i=0;i<2;i++)profile.add({...favourite,rating:0.5},{artists:[known]});
 const score=compileTasteScorer(profile.snapshot());
 const unknown=score({artists:[known,{id:'artist:unknown',name:'Unknown'}]});
 const mixed=score({artists:[known,ambiguous]});
 expect(mixed).toEqual(unknown);
 expect(mixed.score!).toBeLessThan(50);
 expect(mixed.reasons).toEqual([{dimension:'artists',name:'Known',direction:'negative',samples:2}]);
 expect(score({artists:[ambiguous]}).score).toBeNull();
});

test('positive feedback measures liked works out of explicitly rated or endorsed works independently of exposure',()=>{
 const acc=createTasteAccumulator({count:10,median:3.5});
 for(let i=0;i<10;i++)acc.add({...watched,rating:i<9?4:2},{genres});
 for(let i=0;i<20;i++)acc.add(watched,{genres});
 for(let i=0;i<10;i++)acc.add(watched,{});
 const profile=acc.snapshot();
 expect(profile).toMatchObject({works:40,worksWithSignals:30,consumedWorks:40,explicitWorks:10,inferredWorks:20});
 expect(decodeTasteAffinities(profile.dimensions.genres!)[0]).toMatchObject({samples:30,consumedSamples:30,explicitSamples:10,positiveFeedbackSamples:9});
});

test('feature medians stay visible while the score also counts opposing ratings',()=>{
 const sciFi={genres:namedFeatures(['Science fiction']),tags:namedFeatures(['Space travel'])};
 const horror={genres:namedFeatures(['Horror']),tags:namedFeatures(['Haunting'])};
 const allLiked=createTasteAccumulator({count:50,median:4});
 const mixed=createTasteAccumulator({count:60,median:4});
 for(let i=0;i<20;i++)for(const accumulator of [allLiked,mixed]){
  accumulator.add({...watched,rating:5},sciFi);
  accumulator.add({...watched,rating:0.5},horror);
 }
 for(let i=0;i<10;i++)mixed.add({...watched,rating:0.5},sciFi);
 const profile=mixed.snapshot();
 expect(decodeTasteAffinities(profile.dimensions.genres!).find(entry=>entry.id==='science fiction'))
  .toMatchObject({samples:30,medianRating:5,positiveFeedbackSamples:20});
 expect(scoreTaste(allLiked.snapshot(),sciFi).score!).toBeGreaterThan(85);
 expect(scoreTaste(profile,sciFi).score!).toBeLessThan(scoreTaste(allLiked.snapshot(),sciFi).score!);
 expect(scoreTaste(profile,horror).score!).toBeLessThan(15);
});

test('stored people favour sustained viewing and supported opinions over incidental credits',()=>{
 const frequent={cast:namedFeatures(['Regular collaborator'])},rated={cast:namedFeatures(['Rated collaborator'])};
 const accumulator=createTasteAccumulator();
 for(let i=0;i<520;i++){
  const incidental={cast:namedFeatures([`Incidental ${i}`])};
  accumulator.add(watched,incidental);
  accumulator.add(watched,incidental);
 }
 accumulator.add({...watched,rating:5},{cast:namedFeatures(['One-off'])});
 for(let i=0;i<20;i++)accumulator.add(watched,frequent);
 for(let i=0;i<8;i++)accumulator.add({...watched,rating:5},rated);
 const profile=accumulator.snapshot();
 expect(profile.works).toBe(1069);
 expect(profile.dimensions.cast).toHaveLength(512);
 expect(profile.dimensions.cast!.map(item=>item[1])).toEqual(expect.arrayContaining(['Regular collaborator','Rated collaborator']));
 expect(profile.dimensions.cast!.some(item=>item[1]==='One-off')).toBe(false);
 expect(scoreTaste(profile,frequent).score!).toBeGreaterThan(50);
 expect(scoreTaste(profile,rated).score!).toBeGreaterThan(scoreTaste(profile,frequent).score!);
});

test('unknown provenance labels distinguish acquisition, listening and play dates',()=>{
 expect(unknownActivityDate('collect')).toBe('Acquisition date unavailable');
 expect(unknownActivityDate('listen')).toBe('Listen date unavailable');
 expect(unknownActivityDate('played')).toBe('Play date unavailable');
});

test('a calculation compiles each affinity once and reuses it without retaining prior candidates',()=>{
 let reads=0;
 const profile={version:1 as const,works:300,dimensions:Object.fromEntries(tasteDimensions.map(dimension=>[dimension,
  Array.from({length:500},(_,index)=>({get id(){reads++;return String(index);},name:String(index),value:index%2?.5:-.5,samples:3}))]))};
 const score=compileTasteScorer(profile);
 expect(reads).toBe(tasteDimensions.length * 500);
 const features=Object.fromEntries(tasteDimensions.map(dimension=>[dimension,[{id:'1',name:'One'}]]));
 const expected=scoreTaste(profile,features),indexed=reads;
 for(let index=0;index<500;index++)expect(score(features)).toEqual(expected);
 expect(reads).toBe(indexed);
 expect(score({})).toMatchObject({score:null,confidence:0,matches:0,reasons:[]});
 expect(score(features)).toEqual(expected);
});

test('a genre alone predicts held-out titles only when explicit feedback distinguishes it from the rest of that medium',()=>{
 const scifi={genres:namedFeatures(['Science fiction'])},comedy={genres:namedFeatures(['Comedy'])};
 const profile=(pairs:number,other:TasteFeatures)=>{
  const acc=createTasteAccumulator();
  for(let i=0;i<pairs;i++){
   acc.add({...watched,rating:5},scifi);
   acc.add({...watched,rating:1},other);
  }
  return acc.snapshot();
 };
 const ranked=compileTasteScorer(profile(12,comedy));
 expect(ranked(scifi).score!).toBeGreaterThan(50);
 expect(ranked(comedy).score!).toBeLessThan(50);
 expect(ranked(comedy).reasons[0].direction).toBe('negative');
 expect(scoreTaste(profile(3,comedy),scifi).score).toBeNull();
 expect(scoreTaste(profile(100,{}),scifi).score).toBeNull();
 expect(scoreTaste(profile(100,scifi),scifi).score).toBeNull();
});

test('selective returns distinguish a creator from routine replay across a medium with the same exposures',()=>{
 const target={directors:cast},others={directors:namedFeatures(['Other director'])};
 const build=(otherReturns:boolean,otherFeatures:TasteFeatures)=>{
  const acc=createTasteAccumulator();
  for(let i=0;i<50;i++){
   acc.add({...watched,repeated:true},target);
   acc.add({...watched,repeated:otherReturns},otherFeatures);
  }
  return acc.snapshot();
 };
 const selective=build(false,others),routine=build(true,others),missing=build(false,{});
 expect(scoreTaste(selective,target).score!).toBeGreaterThan(scoreTaste(routine,target).score!);
 expect(scoreTaste(missing,target).score).toBe(scoreTaste(routine,target).score);

 const acc=createTasteAccumulator(),drama={genres},comedy={genres:namedFeatures(['Comedy'])};
 for(let i=0;i<50;i++){
  acc.add({...watched,repeated:true},drama);
  acc.add(watched,comedy);
 }
 const score=compileTasteScorer(acc.snapshot());
 expect(score(drama).score!).toBeGreaterThan(50);
 expect(score(comedy).score).toBeNull();
});

test('long game exposure provides a small tie-breaker, while short games, missing time and explicit dislikes are protected',()=>{
 const strategy={developers:namedFeatures(['Strategy studio'])},puzzle={developers:namedFeatures(['Puzzle studio'])};
 const games=(longRank:number|null,shortRank:number|null,rating:number|null=null)=>{
  const acc=createTasteAccumulator();
  for(let i=0;i<30;i++){
   acc.add({...watched,playtimeRank:longRank,rating},strategy);
   acc.add({...watched,playtimeRank:shortRank,rating},puzzle);
  }
  const score=compileTasteScorer(acc.snapshot());
  return [score(strategy).score!,score(puzzle).score!];
 };
 const unknown=games(null,null),timed=games(0.9,-0.9);
 expect(unknown[0]).toBe(unknown[1]);
 expect(timed[0]).toBeGreaterThan(timed[1]);
 expect(timed[0]-timed[1]).toBeLessThanOrEqual(4);
 expect(timed[1]).toBe(unknown[1]);
 expect(games(0.9,-0.9,1)).toEqual(games(null,null,1));
});

test('persisted reference preserves score, evidence and aliases without retaining singleton credits',()=>{
 const profile=createTasteAccumulator();
 const features={cast:[{id:'__proto__',name:'Lead'}],tags:namedFeatures(['toString','one-off']),genres:namedFeatures(['Comedy'])};
 for(let i=0;i<12;i++)profile.add(favourite,features);
 profile.add(watched,{genres:namedFeatures(['one-off']),cast:namedFeatures(['Once'])});
 const full=profile.snapshot();
 const reference=JSON.parse(JSON.stringify(prepareTasteReference(full)));
 expect(Object.hasOwn(reference.dimensions.cast,'once')).toBe(false);
 expect(Object.hasOwn(reference.genres,'one-off')).toBe(true);
 expect(Object.hasOwn(reference.dimensions.cast,'__proto__')).toBe(true);
 const lookup=scorerFromReference(reference);
 expect(lookup(features)).toEqual(scoreTaste(full,features));
 expect(lookup({cast:[{id:'constructor',name:'Unknown'}]})).toMatchObject({matches:0,score:null});
 expect(lookup({tags:namedFeatures(['one-off'])})).toMatchObject({matches:0,score:null});
});

test('rating combinations contribute after their individual genre and theme effects',async()=>{
 const sciFi=namedFeatures(['Science fiction']),fantasy=namedFeatures(['Fantasy']);
 const quiet=namedFeatures(['Quiet exploration']),loud=namedFeatures(['Intense combat']);
 const target={genres:sciFi,tags:quiet},opposite={genres:sciFi,tags:loud};
 const trainer=createTasteRatingTrainer(60,3.5),history=createTasteAccumulator({count:60,median:3.5});
 for(let i=0;i<15;i++)for(const [rating,features] of [[5,target],[2,opposite],[2,{genres:fantasy,tags:quiet}],[5,{genres:fantasy,tags:loud}]] as const){
  trainer.add(rating,features);
  history.add({...watched,rating},features);
 }
 const weights=await trainer.fit();
 expect(tasteRatingAdjustment(weights,target)).toBeGreaterThan(0);
 expect(tasteRatingAdjustment(weights,opposite)).toBeLessThan(0);
 expect(tasteRatingAdjustment({'genres:science fiction':100},target)).toBe(8);
 expect(tasteRatingAdjustment({'genres:science fiction':-100},target)).toBe(-8);
 const profile=history.snapshot(),reference=JSON.parse(JSON.stringify(prepareTasteReference(profile,weights)));
 const score=scorerFromReference(reference);
 expect(score(target).score!).toBeGreaterThan(scoreTaste(profile,target).score!);
 expect(score(target).confidence).toBe(scoreTaste(profile,target).confidence);
 const {breakdown,...inspected}=scorerFromReference(reference,true)(target);
 expect(inspected).toEqual(score(target));
 expect(breakdown!.signals.reduce((sum,signal)=>sum+signal.weightShare,0)).toBeCloseTo(1,8);
 expect(breakdown!.calculation!.baseScore+breakdown!.calculation!.ratingAdjustment).toBe(inspected.score!);
 expect(breakdown!.calculation!.ratingTerms.some(term=>term.name==='Science fiction + Quiet exploration'&&term.points>0)).toBe(true);
 expect(score(opposite).score!).toBeLessThan(scoreTaste(profile,opposite).score!);
 expect(score({}).score).toBeNull();
 const tooFew=createTasteRatingTrainer(39,3.5);
 for(let i=0;i<39;i++)tooFew.add(i%2?5:2,target);
 expect(await tooFew.fit()).toBeUndefined();
});

test('admin breakdown keeps context for a withheld match without a calculated score',()=>{
 const profile=item(25,favourite,{languages:namedFeatures(['English'])});
 const result=scorerFromReference(prepareTasteReference(profile),true)({languages:namedFeatures(['English'])});
 expect(result.score).toBeNull();
 expect(result.breakdown).toMatchObject({withheld:'context',signals:[{dimension:'languages',context:true,matched:1,compared:1}]});
 expect(result.breakdown?.calculation).toBeUndefined();
});

test('below-usual ratings outweigh mild familiarity and keep neutral ratings neutral',()=>{
 const profileFor=(rating:number)=>{
  const acc=createTasteAccumulator({count:40,median:4});
  for(let i=0;i<16;i++)acc.add({...watched,rating},{cast});
  return acc.snapshot();
 };
 expect(scoreTaste(profileFor(4),{cast}).score).toBe(50);
 expect(profileFor(3).dimensions.cast![0][5]).toBeGreaterThan(10);
 expect(profileFor(0.5).dimensions.cast![0][5]).toBe(16);
});

test('a substantial opposing signal appears alongside the strongest matches',()=>{
 const pleasant={cast,directors:namedFeatures(['Director']),tags},unpleasant={writers:namedFeatures(['Writer'])};
 const acc=createTasteAccumulator();
 for(let i=0;i<20;i++){
  acc.add({...watched,rating:5},pleasant);
  acc.add({...watched,rating:1.5},unpleasant);
 }
 const mixed=scoreTaste(acc.snapshot(),{...pleasant,...unpleasant});
 expect(mixed.reasons).toHaveLength(3);
 expect(mixed.reasons.map(reason=>reason.direction)).toContain('positive');
 expect(mixed.reasons).toContainEqual({dimension:'writers',name:'Writer',direction:'negative',samples:20});
 const positive=scoreTaste(acc.snapshot(),pleasant);
 expect(positive.reasons.every(reason=>reason.direction==='positive')).toBe(true);
});
