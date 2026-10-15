import {test,expect} from 'bun:test';
import {buildTasteProfile,scoreTaste,compileTasteScorer,tasteDimensions,namedFeatures} from '../src/lib/social/taste-profile';
import {unknownActivityDate} from '../src/lib/social/model';
const genres=namedFeatures(['Drama']),cast=[{id:'tmdb:1',name:'Actor'}];
test('explicit negative feedback defeats repeats and consumption for the same title',()=>{
 const profile=buildTasteProfile([{id:'a',weight:3,features:{genres}},{id:'a',weight:-5,features:{genres}},{id:'a',weight:5,features:{genres}}]);
 expect(profile.works).toBe(1);expect(profile.dimensions.genres![0].samples).toBe(1);
 expect(scoreTaste(profile,{genres}).score).toBeLessThan(50);
});
test('cast requires repeated titles and missing metadata is not a negative vote',()=>{
 const one=buildTasteProfile([{id:'a',weight:5,features:{cast}}]);
 expect(scoreTaste(one,{cast}).score).toBeNull();
 const two=buildTasteProfile([{id:'a',weight:5,features:{cast}},{id:'b',weight:5,features:{cast}}]);
 expect(scoreTaste(two,{cast}).score).toBeGreaterThan(50);
 expect(scoreTaste(two,{genres}).score).toBeNull();
 expect(scoreTaste(two,{cast}).reasons[0].name).toBe('Actor');
});
test('tags, creators and music artists remain separate signals with bounded confidence',()=>{
 const evidence=Array.from({length:10},(_,i)=>({id:String(i),weight:5,features:{genres,tags:[{id:'tag:1',name:'Space exploration'}],artists:namedFeatures(['Artist'])}}));
 const result=scoreTaste(buildTasteProfile(evidence),evidence[0].features);
 expect(result.score).toBe(100);expect(result.confidence).toBe(100);
 expect(Object.keys(result.dimensions)).toEqual(['genres','tags','artists']);
});
test('unknown provenance labels distinguish acquisition, listening and play dates',()=>{
 expect(unknownActivityDate('collect')).toBe('Acquisition date unavailable');
 expect(unknownActivityDate('listen')).toBe('Listen date unavailable');
 expect(unknownActivityDate('played')).toBe('Play date unavailable');
});
test('repeated dropped titles never produce a score below zero',()=>{
 const profile=buildTasteProfile(Array.from({length:8},(_,i)=>({id:String(i),weight:-6,features:{genres}})));
 expect(scoreTaste(profile,{genres}).score).toBe(0);
 expect(scoreTaste(profile,{genres}).dimensions.genres).toBe(0);
});

test('a calculation compiles each affinity once and reuses it without retaining prior candidates',()=>{
 let reads=0;
 const profile={version:1 as const,works:300,dimensions:Object.fromEntries(tasteDimensions.map(dimension=>[dimension,Array.from({length:500},(_,index)=>({get id(){reads++;return String(index);},name:String(index),value:index%2?.5:-.5,samples:3}))]))};
 const score=compileTasteScorer(profile);
 expect(reads).toBe(6000);
 const features=Object.fromEntries(tasteDimensions.map(dimension=>[dimension,[{id:'1',name:'One'}]]));
 const expected=scoreTaste(profile,features);
 const indexed=reads;
 for(let index=0;index<500;index++)expect(score(features)).toEqual(expected);
 expect(reads).toBe(indexed);
 expect(score({})).toMatchObject({score:null,confidence:0,matches:0,reasons:[]});
 expect(score(features)).toEqual(expected);
});
