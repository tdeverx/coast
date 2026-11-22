import {test,expect} from 'bun:test';
import {buildTasteProfile,scoreTaste,compileTasteScorer,prepareTasteReference,scorerFromReference,createTasteAccumulator,decodeTasteAffinities,tasteDimensions,namedFeatures,
 type TasteFeatures,type TasteWorkEvidence} from '../src/lib/social/taste-profile';
import {comparisonSignals,tasteSignalLabel} from '../src/lib/social/taste';
import {unknownActivityDate} from '../src/lib/social/model';
import {createTasteRatingTrainer,friendTasteAdjustment,negativeRatingWeight,ratingInfluence,tasteRatingAdjustment} from '../src/lib/social/taste-rating-model';

const genres=namedFeatures(['Drama']),cast=namedFeatures(['Actor']),tags=namedFeatures(['Space exploration']);
const watched:TasteWorkEvidence={rating:null,explicit:0,implicit:3,consumed:true,repeated:false};
const favourite:TasteWorkEvidence={rating:null,explicit:5,implicit:0,consumed:false,repeated:false};
const item=(count:number,evidence:TasteWorkEvidence,features:TasteFeatures)=>{
 const profile=createTasteAccumulator();
 for(let i=0;i<count;i++)profile.add(evidence,features);
 return profile.snapshot();
};

test('profile and comparison signals are scoped and named for the medium',()=>{
 expect(comparisonSignals('movies')).toContain('cast');
 expect(comparisonSignals('movies')).not.toContain('mechanics');
 expect(comparisonSignals('movies')).not.toContain('networks');
 expect(comparisonSignals('tv')).toContain('networks');
 expect(comparisonSignals('game')).toContain('mechanics');
 expect(comparisonSignals('game')).not.toContain('cast');
 expect(comparisonSignals('music')).toContain('artists');
 expect(comparisonSignals('comic')).toContain('illustrators');
 expect(comparisonSignals('book')).not.toContain('developers');
 expect(tasteSignalLabel('writers','comic')).toBe('Authors');
 expect(tasteSignalLabel('tags','book')).toBe('Subjects');
 expect(tasteSignalLabel('mechanics','game')).toBe('Game modes');
});

test('visible overlap counts each work once and preserves the strongest explicit dislike regardless of input order',()=>{
 const rows=[3,-6,-5,5].map(weight=>({id:'a',weight,features:{genres}}));
 const a=buildTasteProfile(rows),b=buildTasteProfile(rows.toReversed());
 expect(a).toEqual(b);expect(a.works).toBe(1);
 expect(a.dimensions.genres![0]).toMatchObject({samples:1,value:-0.4});
});

test('a supported genre can score on its own and its aliases count once',()=>{
 const features={genres,tags:namedFeatures(['DRAMA']),themes:namedFeatures(['Drama'])};
 const profile=item(100,favourite,features);
 const genre=scoreTaste(profile,{genres});
 expect(genre.score!).toBeGreaterThan(50);
 expect(scoreTaste(profile,features)).toEqual(genre);
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

test('the taste wall leads with sustained evidence while keeping one-off affinities available',()=>{
 const history=createTasteAccumulator();
 const regular={tags:namedFeatures(['Quiet mysteries'])};
 const oneOff={tags:namedFeatures(['Haunted houses'])};
 for(let count=0;count<24;count++)history.add({...watched,rating:3.5},regular);
 history.add({...watched,rating:5},oneOff);
 const profile=history.snapshot();
 const [regularAffinity,oneOffAffinity]=decodeTasteAffinities(profile.dimensions.tags!);
 expect(regularAffinity.value).toBeLessThan(oneOffAffinity.value);
 expect(profile.signals.tags?.preview.map(signal=>signal.name)).toEqual(['Quiet mysteries','Haunted houses']);
 expect(scoreTaste(profile,oneOff).score).toBeNull();
});

test('explicit ratings keep the same meaning across rating histories and retain their raw like rate',()=>{
 const rate=(median:number,rating:number)=>{
  const acc=createTasteAccumulator({count:20,median});
  for(let i=0;i<8;i++)acc.add({...watched,rating,explicit:5,repeated:true},{cast});
  return acc.snapshot();
 };
 const liked=rate(2,4),generous=rate(5,4);
 expect(scoreTaste(liked,{cast})).toEqual(scoreTaste(generous,{cast}));
 expect(scoreTaste(generous,{cast}).score!).toBeGreaterThan(50);
 expect(generous.medianRating).toBe(5);
 expect(decodeTasteAffinities(generous.dimensions.cast!)[0]).toMatchObject({explicitSamples:8,positiveFeedbackSamples:8,consumedSamples:8,repeatedSamples:8});
 const disliked=rate(5,0.5),result=scoreTaste(disliked,{cast});
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
 expect(actor(frequent).value).toBeGreaterThan(actor(occasional).value);
 expect(actor(returning).value-actor(frequent).value).toBeGreaterThan(actor(frequent).value-actor(occasional).value);
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

test('a deliberate return reinforces rated features with one observation per title',()=>{
 const features={genres,tags,cast,franchises:namedFeatures(['A series']),
  artists:[{id:'artist:1',name:'A musician'}],developers:namedFeatures(['A developer'])};
 const rating={...watched,rating:4};
 const once=item(20,rating,features);
 const repeat=item(20,{...rating,repeated:true},features);
 const dropped=item(20,{...rating,repeated:true,implicit:-2},features);
 expect(repeat).toMatchObject({works:20,explicitWorks:20,inferredWorks:0,repeatedWorks:20});
 for(const dimension of ['genres','tags','cast','franchises','artists','developers'] as const){
  const [original]=decodeTasteAffinities(once.dimensions[dimension]!);
  const [returned]=decodeTasteAffinities(repeat.dimensions[dimension]!);
  const [abandoned]=decodeTasteAffinities(dropped.dimensions[dimension]!);
  expect(returned.value).toBeGreaterThan(original.value);
  expect(returned).toMatchObject({samples:20,explicitSamples:20,repeatedSamples:20,medianRating:4});
  expect(abandoned.value).toBe(original.value);
 }
 expect(scoreTaste(repeat,features).score!).toBeGreaterThan(scoreTaste(once,features).score!);
 expect(scoreTaste(repeat,features).confidence).toBe(scoreTaste(once,features).confidence);
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

test('composer and catalogue context need a primary match, while verified artists and cinematographers can support one',()=>{
 const artist=(id:string)=>[{id,name:'The Artist'}];
 const modes=namedFeatures(['Single player']),decades=namedFeatures(['1990s']);
 const ambiguous={mechanics:modes,perspectives:namedFeatures(['First person']),decades,artists:artist('artist-name:the artist')};
 expect(scoreTaste(item(40,watched,ambiguous),ambiguous).score).toBeNull();
 const composer={composers:artist('verified:123')};
 expect(scoreTaste(item(40,watched,composer),composer).score).toBeNull();
 for(const dimension of ['artists','cinematographers'] as const){
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

test('a single genre learns positive and negative preferences without requiring competing genres',()=>{
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
 expect(ranked(scifi).confidence).toBeGreaterThan(scoreTaste(profile(3,comedy),scifi).confidence);
 expect(scoreTaste(profile(1,comedy),scifi).score).toBeNull();
 expect(scoreTaste(profile(100,{}),scifi).score!).toBeGreaterThan(50);
 expect(scoreTaste(profile(100,scifi),scifi).score!).toBeLessThan(ranked(scifi).score!);
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
 expect(scoreTaste(selective,target).dimensions.directors!).toBeGreaterThan(scoreTaste(routine,target).dimensions.directors!);
 expect(scoreTaste(missing,target).score).toBe(scoreTaste(routine,target).score);

 const acc=createTasteAccumulator(),drama={genres},comedy={genres:namedFeatures(['Comedy'])};
 for(let i=0;i<50;i++){
  acc.add({...watched,repeated:true},drama);
  acc.add(watched,comedy);
 }
 const score=compileTasteScorer(acc.snapshot());
 expect(score(drama).score!).toBeGreaterThan(50);
 expect(score(drama).score!).toBeGreaterThan(score(comedy).score!);
});

test('rated returns reinforce a feature more when returning to other rated titles is less common',()=>{
 const returning={tags:namedFeatures(['Space travel'])},other={tags:namedFeatures(['Haunting'])};
 const affinity=(routine:boolean)=>{
  const history=createTasteAccumulator();
  for(let i=0;i<60;i++){
   history.add({...watched,rating:4,repeated:true},returning);
   history.add({...watched,rating:4,repeated:routine},other);
  }
  return decodeTasteAffinities(history.snapshot().dimensions.tags!).find(entry=>entry.id==='space travel')!.value;
 };
 expect(affinity(false)).toBeGreaterThan(affinity(true));
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

test('persisted references preserve scores and count a supported tag independently of an unrelated singleton genre',()=>{
 const profile=createTasteAccumulator();
 const features={cast:[{id:'__proto__',name:'Lead'}],tags:namedFeatures(['toString','one-off']),genres:namedFeatures(['Comedy'])};
 for(let i=0;i<12;i++)profile.add(favourite,features);
 profile.add(watched,{genres:namedFeatures(['one-off']),cast:namedFeatures(['Once'])});
 const full=profile.snapshot();
 const reference=JSON.parse(JSON.stringify(prepareTasteReference(full)));
 expect(Object.hasOwn(reference.dimensions.cast,'once')).toBe(false);
 expect(Object.hasOwn(reference.dimensions.cast,'__proto__')).toBe(true);
 const lookup=scorerFromReference(reference);
 expect(lookup(features)).toEqual(scoreTaste(full,features));
 expect(lookup({cast:[{id:'constructor',name:'Unknown'}]})).toMatchObject({matches:0,score:null});
 expect(lookup({tags:namedFeatures(['one-off'])})).toMatchObject({matches:1,reasons:[{dimension:'tags',name:'one-off'}]});
});

test('rating combinations contribute after their individual genre and theme effects',async()=>{
 const sciFi=namedFeatures(['Science fiction']),fantasy=namedFeatures(['Fantasy']);
 const quiet=namedFeatures(['Quiet exploration']),loud=namedFeatures(['Intense combat']);
 const target={genres:sciFi,tags:quiet},opposite={genres:sciFi,tags:loud};
 const trainer=createTasteRatingTrainer(60),history=createTasteAccumulator({count:60,median:3.5});
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
 const tooFew=createTasteRatingTrainer(39);
 for(let i=0;i<39;i++)tooFew.add(i%2?5:2,target);
 expect(await tooFew.fit()).toBeUndefined();
});

test('genre and creator returns separate ties without changing unrated scores or support',()=>{
 const genre=namedFeatures(['Science fiction']),otherGenre=namedFeatures(['Fantasy']);
 const writer=namedFeatures(['Writer A']),otherWriter=namedFeatures(['Writer B']);
 const returning={genres:genre,writers:writer},other={genres:genre,writers:otherWriter};
 const history=createTasteAccumulator();
 for(let i=0;i<60;i++){
  history.add({...watched,repeated:true},returning);
  history.add(watched,other);
  history.add(watched,{genres:otherGenre,writers:writer});
  history.add({...watched,repeated:true},{genres:otherGenre,writers:otherWriter});
 }
 const profile=history.snapshot(),returnWeights=history.returnWeights();
 const reference=prepareTasteReference(profile,undefined,returnWeights);
 const score=scorerFromReference(reference,true);
 const first=score(returning),second=score(other);
 expect(first.score).toBe(scoreTaste(profile,returning).score);
 expect(second.score).toBe(scoreTaste(profile,other).score);
 expect(first.score).toBe(second.score);
 expect(first.confidence).toBe(scoreTaste(profile,returning).confidence);
 expect(first.returnTieBreak).toBeGreaterThan(0);
 expect(second.returnTieBreak).toBeLessThan(0);
 expect(first.breakdown?.calculation?.ratingTerms).toEqual([]);
 expect(score({}).score).toBeNull();
});

test('admin breakdown keeps context for a withheld match without a calculated score',()=>{
 const profile=item(25,favourite,{languages:namedFeatures(['English'])});
 const result=scorerFromReference(prepareTasteReference(profile),true)({languages:namedFeatures(['English'])});
 expect(result.score).toBeNull();
 expect(result.breakdown).toMatchObject({withheld:'context',signals:[{dimension:'languages',context:true,matched:1,compared:1}]});
 expect(result.breakdown?.calculation).toBeUndefined();
});

test('the fixed star scale keeps three stars neutral and preserves explicit dislikes',()=>{
 const profileFor=(rating:number)=>{
  const acc=createTasteAccumulator({count:40,median:4});
  for(let i=0;i<16;i++)acc.add({...watched,rating},{cast});
  return acc.snapshot();
 };
 const neutral=profileFor(3);
 expect(decodeTasteAffinities(neutral.dimensions.cast!)[0]).toMatchObject({value:0,medianRating:3,explicitSamples:16});
 expect(scoreTaste(neutral,{cast}).score).toBeNull();
 expect(scoreTaste(profileFor(2.5),{cast}).score!).toBeLessThan(50);
 expect(scoreTaste(profileFor(3.5),{cast}).score!).toBeGreaterThan(50);
 expect(profileFor(0.5).dimensions.cast![0][5]).toBe(16);
});

test('observed neutral ratings count lightly while a strong affinity shrinks only at the title match',()=>{
 const features={genres:namedFeatures(['Science fiction'])};
 const pool=(ratings:number[],repeated=false)=>{
  const history=createTasteAccumulator();
  for(const rating of ratings)history.add({...watched,rating,repeated},features);
  return history.snapshot();
 };
 expect([3,3.5,4,4.5,5].map(ratingInfluence)).toEqual([.15,.25,.5,.75,1]);
 expect([.5,1,2,3].map(ratingInfluence)).toEqual([1,1,.5,.15]);
 const strong=pool([5,5]),neutral=pool([5,5,...Array(20).fill(3)]);
 const [signal]=decodeTasteAffinities(neutral.dimensions.genres!);
 expect(signal).toMatchObject({explicitSamples:22,medianRating:3});
 expect(scoreTaste(pool([5,5,3]),features)).toMatchObject({score:76,confidence:35,dimensions:{genres:96}});
 expect(scoreTaste(neutral,features)).toMatchObject({score:67,dimensions:{genres:70}});
 expect(scoreTaste(pool([5,3,3]),features).score).toBeNull();
 expect(scoreTaste(strong,features)).toMatchObject({score:77,confidence:33,dimensions:{genres:99}});
 for(const repeated of [false,true]){
  const [mild,moderate,high]=[3.5,4,5].map(rating=>pool(Array(16).fill(rating),repeated).dimensions.genres![0][2]);
  expect(high).toBeGreaterThan(moderate);
  expect(moderate).toBeGreaterThan(mild);
 }
 expect(scoreTaste(pool(Array(16).fill(3),true),features).score!).toBeGreaterThan(50);
 const endorsed=item(2,{...watched,explicit:5,rating:3},features);
 expect(scoreTaste(endorsed,features)).toEqual(scoreTaste(strong,features));
});

test('conflicting ratings bring a strong genre match back toward neutral',()=>{
 const features={genres:namedFeatures(['Sci-Fi'])};
 const history=(ratings:number[])=>{
  const profile=createTasteAccumulator();
  for(const rating of ratings)profile.add({...watched,rating},features);
  return profile.snapshot();
 };
 const score=(ratings:number[])=>scoreTaste(history(ratings),features);
 expect(score([5,5,2])).toMatchObject({score:71,dimensions:{genres:85}});
 expect(score([5,5,1])).toMatchObject({score:60,dimensions:{genres:67}});
 expect(score([5,5,.5]).score).toBe(60);
 expect(score([5,4.5,1]).score).toBe(56);
 expect(score([5,5,1,1]).score).toBe(50);
 expect(score([5,5,1,1,1]).score).toBe(43);
 expect(score([1,1,5])).toMatchObject({score:40,dimensions:{genres:33}});
 // A weak numerical majority cannot strengthen an opposing weighted preference.
 expect(history([5,2,2]).dimensions.genres![0][2]).toBe(.245);
 expect(history([1,4,4]).dimensions.genres![0][2]).toBe(-.245);
});

test('crowd consensus weakens shared dislikes for all affinities while preserving the raw rating',()=>{
 const audience={score:4,votes:400,scale:10} as const;
 const weight=negativeRatingWeight(2,audience);
 expect(weight).toBeCloseTo(0.6);
 expect(negativeRatingWeight(2,{...audience,score:40,scale:100})).toBe(weight);
 expect(negativeRatingWeight(2,{...audience,votes:10})).toBe(1);
 expect(negativeRatingWeight(2,{...audience,score:8})).toBe(1);
 expect(negativeRatingWeight(0.5,audience)).toBe(1);
 expect(negativeRatingWeight(4,audience)).toBe(1);
 expect(negativeRatingWeight(null,audience)).toBe(1);
 const raw=createTasteAccumulator(),adjusted=createTasteAccumulator();
 for(let i=0;i<5;i++){
  const evidence={...watched,rating:2},features={genres,tags,cast};
  raw.add(evidence,features);
  adjusted.add(evidence,features,weight);
 }
 for(const dimension of ['genres','tags','cast'] as const){
  const [before]=decodeTasteAffinities(raw.snapshot().dimensions[dimension]!);
  const [after]=decodeTasteAffinities(adjusted.snapshot().dimensions[dimension]!);
  expect(after.value).toBeGreaterThan(before.value);
  expect(after.value).toBeLessThan(0);
  expect(after).toMatchObject({medianRating:2,explicitSamples:5,positiveFeedbackSamples:0});
 }
});

test('the learned rating adjustment also softens a dislike supported by the crowd',async()=>{
 const disliked={tags:namedFeatures(['Slasher'])},liked={tags:namedFeatures(['Space travel'])};
 const weight=negativeRatingWeight(2,{score:4,votes:400,scale:10});
 const raw=createTasteRatingTrainer(60),adjusted=createTasteRatingTrainer(60);
 for(let i=0;i<30;i++){
  raw.add(2,disliked);raw.add(3.5,liked);
  adjusted.add(2,disliked,weight);adjusted.add(3.5,liked);
 }
 expect(tasteRatingAdjustment(await adjusted.fit(),disliked)).toBeGreaterThan(tasteRatingAdjustment(await raw.fit(),disliked));
});

test('a neutral rating changes learned feature weights less than a stronger opinion',async()=>{
 const drama={genres},scifi={tags};
 const selective=createTasteRatingTrainer(40),mixed=createTasteRatingTrainer(60),strong=createTasteRatingTrainer(60);
 for(let i=0;i<20;i++){
  selective.add(5,scifi);selective.add(1,drama);
  mixed.add(5,scifi);mixed.add(1,drama);
  strong.add(5,scifi);strong.add(1,drama);
  mixed.add(3,scifi);strong.add(1,scifi);
 }
 const key='tags:space exploration';
 const before=(await selective.fit())![key],withNeutral=(await mixed.fit())![key],withDislike=(await strong.fit())![key];
 expect(withNeutral).toBeLessThan(before);
 expect(withNeutral).toBeGreaterThan(withDislike);
});

test('matching cast credits require three distinct titles with evidence',()=>{
 const features={cast,genres};
 const history=createTasteAccumulator();
 for(let i=0;i<2;i++)history.add({...watched,rating:5},features);
 history.add({...watched,rating:3},{cast});
 const early=history.snapshot();
 expect(prepareTasteReference(early).dimensions.cast).toBeUndefined();
 expect(scoreTaste(early,features).reasons.map(reason=>reason.dimension)).toEqual(['genres']);
 history.add({...watched,rating:5},features);
 expect(scoreTaste(history.snapshot(),features).reasons.map(reason=>reason.dimension)).toContain('cast');
});

test('well-supported completion patterns can strengthen any affinity without overruling dislikes',()=>{
 for(const dimension of ['networks','studios','cast','developers','writers','genres'] as const){
  const features={[dimension]:namedFeatures(['Followed'])};
  const other={[dimension]:namedFeatures(['Other'])};
  const build=(resolved:boolean,disliked=false)=>{
   const history=createTasteAccumulator();
   for(let i=0;i<40;i++){
    history.add({...watched,rating:disliked?1:null,completion:resolved?true:null},features);
    history.add({...watched,completion:resolved?false:null},other);
   }
   return history.snapshot();
  };
  const [known]=decodeTasteAffinities(build(true).dimensions[dimension]!).filter(entry=>entry.id==='followed');
  const [unknown]=decodeTasteAffinities(build(false).dimensions[dimension]!).filter(entry=>entry.id==='followed');
  expect(known.value).toBeGreaterThan(unknown.value);
  expect(prepareTasteReference(build(true)).dimensions[dimension]!.followed[5])
   .toBeGreaterThan(prepareTasteReference(build(false)).dimensions[dimension]!.followed[5]);
  const [disliked]=decodeTasteAffinities(build(true,true).dimensions[dimension]!).filter(entry=>entry.id==='followed');
  expect(disliked.value).toBeLessThan(0);
 }
});

test('subject terms beyond the previous fit cutoffs can contribute points',()=>{
 const features={genres:namedFeatures(Array.from({length:12},(_,i)=>`Genre ${i}`)),
  tags:namedFeatures(Array.from({length:20},(_,i)=>`Tag ${i}`)),
  themes:namedFeatures(Array.from({length:12},(_,i)=>`Theme ${i}`))};
 const inputs:Parameters<typeof tasteRatingAdjustment>[2]=[];
 expect(tasteRatingAdjustment({'genres:genre 11':0.2,'tags:tag 19':0.2,'themes:theme 11':0.2},features,inputs)).toBeGreaterThan(0);
 expect(inputs.map(term=>term.name)).toEqual(['Genre 11','Tag 19','Theme 11']);
});

test('title affinity weights follow the priority order when the evidence is equally strong',()=>{
 const features={genres,tags,themes:namedFeatures(['Found family']),cast,networks:namedFeatures(['Network']),
  studios:namedFeatures(['Studio']),decades:namedFeatures(['1990s']),countries:namedFeatures(['Canada']),
  languages:namedFeatures(['English']),composers:namedFeatures(['Composer'])};
 const result=scorerFromReference(prepareTasteReference(item(35,favourite,features)),true)(features);
 const signals=new Map(result.breakdown!.signals.map(signal=>[signal.dimension,signal]));
 const share=(dimension:keyof typeof features)=>signals.get(dimension)!.weightShare;
 for(const dimension of ['genres','tags','themes'] as const){
  expect(signals.get(dimension)?.context).toBe(false);
  expect(share(dimension)).toBeGreaterThan(share('cast'));
 }
 expect(share('cast')).toBeGreaterThan(share('networks'));
 expect(share('networks')).toBe(share('studios'));
 expect(share('studios')).toBeGreaterThan(share('decades'));
 expect(share('decades')).toBeGreaterThan(share('countries'));
 expect(share('countries')).toBeGreaterThan(share('languages'));
 expect(share('languages')).toBeGreaterThan(share('composers'));
});

test('following an actor across titles increases cast weight within the genre and tag ceiling',()=>{
 const features={genres,tags,cast};
 const score=(distinctTitles:number)=>{
  const history=createTasteAccumulator();
  for(let i=0;i<8;i++)history.add({...watched,rating:4},{genres,tags});
  for(let i=0;i<distinctTitles;i++)history.add(watched,{cast});
  const reference=prepareTasteReference(history.snapshot(),{'cast:actor':100});
  return scorerFromReference(reference,true)(features);
 };
 const scarce=score(3),frequent=score(40);
 const weight=(result:typeof scarce,dimension:keyof typeof features)=>
  result.breakdown!.signals.find(signal=>signal.dimension===dimension)!.weightShare;
 expect(score(2).breakdown!.signals.some(signal=>signal.dimension==='cast')).toBe(false);
 expect(weight(frequent,'cast')).toBeGreaterThan(weight(scarce,'cast'));
 expect(weight(frequent,'cast')).toBeLessThan(weight(frequent,'genres'));
 expect(weight(frequent,'cast')).toBeLessThan(weight(frequent,'tags'));
 expect(frequent.breakdown!.calculation!.ratingAdjustment).toBe(0);
});

test('a consistent network or studio rating pattern scales its influence in either direction',()=>{
 for(const dimension of ['networks','studios'] as const){
  const feature={[dimension]:namedFeatures(['Matched'])},other={[dimension]:namedFeatures(['Other'])};
  const score=(high:number,low:number)=>{
   const history=createTasteAccumulator();
   for(let i=0;i<15;i++)history.add({...watched,rating:4},{genres});
   for(let i=0;i<30;i++)history.add({...watched,rating:i%2?1:5},other);
   for(let i=0;i<high+low;i++)history.add({...watched,rating:i<high?5:1},feature);
   return scorerFromReference(prepareTasteReference(history.snapshot()),true)({genres,...feature});
  };
  const liked=score(24,2),mixed=score(13,13),disliked=score(2,24);
  const weight=(result:typeof liked)=>result.breakdown!.signals.find(signal=>signal.dimension===dimension)!.weightShare;
  expect(weight(liked)).toBeGreaterThan(weight(mixed));
  expect(weight(disliked)).toBeGreaterThan(weight(mixed));
  expect(weight(disliked)).toBeGreaterThan(weight(score(0,4)));
  expect(liked.score!).toBeGreaterThan(mixed.score!);
  expect(disliked.score!).toBeLessThan(mixed.score!);
 }
});

test('the same signed evidence moves every affinity and a supported title in the expected direction',()=>{
 for(const dimension of tasteDimensions){
  const feature={[dimension]:namedFeatures(['Test preference'])};
  const anchor={genres:namedFeatures(['Independent genre']),tags:namedFeatures(['Independent subject'])};
  const candidate={...anchor,[dimension]:[...anchor[dimension as keyof typeof anchor]??[],...feature[dimension]!]};
  const run=(stars:number[])=>{
   const history=createTasteAccumulator();
   for(let i=0;i<12;i++)history.add({...watched,rating:4},anchor);
   for(const rating of stars)history.add({...watched,rating},feature);
   const profile=history.snapshot();
   const affinity=decodeTasteAffinities(profile.dimensions[dimension]!).find(({id})=>id==='test preference')!;
   const reference=prepareTasteReference(profile);
   const match=scorerFromReference(reference,true)(candidate);
   expect(scorerFromReference(JSON.parse(JSON.stringify(reference)),true)(candidate)).toEqual(match);
   return {value:affinity.value,score:match.score!,confidence:match.confidence};
  };
  const results=[0,4,12,20,24].map(high=>run([...Array(high).fill(5),...Array(24-high).fill(1)]));
  expect(results[0].value).toBeLessThan(0);
  expect(results[2].value).toBe(0);
  expect(results[4].value).toBeGreaterThan(0);
  for(let i=1;i<results.length;i++){
   expect(results[i].value).toBeGreaterThan(results[i-1].value);
   expect(results[i].score,dimension).toBeGreaterThanOrEqual(results[i-1].score);
   expect(results[i].confidence).toBeGreaterThan(0);
  }
  expect(results[4].score,dimension).toBeGreaterThan(results[0].score);
 }
});

test('similar friends add bounded signed evidence, with an unrated watch weaker than a high rating',()=>{
 const friend=(rating:number|null,shared=20,difference=0)=>({rating,shared,difference});
 const adjustment=(...ratings:(number|null)[])=>friendTasteAdjustment(ratings.map(rating=>friend(rating)));
 expect(adjustment(null)).toEqual({watched:1,rated:0,points:1});
 expect(adjustment(5).points).toBeGreaterThan(adjustment(null).points);
 expect(adjustment(1).points).toBe(-adjustment(5).points);
 expect(adjustment(3).points).toBe(0);
 expect(adjustment(5,1).points).toBe(0);
 expect(adjustment(...Array(24).fill(5)).points).toBeLessThanOrEqual(6);
 expect(friendTasteAdjustment([friend(5,7),friend(5,20,1)])).toEqual({watched:0,rated:0,points:0});
 expect(friendTasteAdjustment([friend(5,120)]).points).toBeGreaterThan(friendTasteAdjustment([friend(5,8,.8)]).points);
});

test('a profile without ratings learns from returning, dropping and saving to watch later',()=>{
 const returning={tags:namedFeatures(['Space opera'])},dropped={tags:namedFeatures(['Slasher'])},
  saved={tags:namedFeatures(['Steampunk'])};
 const history=createTasteAccumulator();
 for(let i=0;i<20;i++){
  history.add({...watched,repeated:true},returning);
  history.add({...watched,implicit:-2,consumed:false},dropped);
  history.add({...watched,implicit:1,consumed:false},saved);
 }
 const score=compileTasteScorer(history.snapshot()),rewatch=score(returning),later=score(saved),stopped=score(dropped);
 expect(rewatch.score!).toBeGreaterThan(later.score!);
 expect(later.score!).toBeGreaterThan(stopped.score!);
 expect(stopped.score!).toBeLessThan(50);
 expect(rewatch.confidence).toBeGreaterThan(later.confidence);
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
