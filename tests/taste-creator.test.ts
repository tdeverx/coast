import {expect,test} from 'bun:test';
import {scorerFromReference,type TasteFeatures} from '../src/lib/social/taste-profile';
import {trainTasteMedium} from '../src/lib/social/taste-training';

const genres=[{id:'drama',name:'Drama'}],person=[{id:'tmdb:1',name:'Creator'}];
const other=[{id:'tmdb:2',name:'Another creator'}];
const roleList=['directors','writers'] as const;

async function example(roles:readonly typeof roleList[number][],ratings:(number|null)[],options:{franchise?:boolean;veto?:boolean;otherRating?:number}={}){
 const model=trainTasteMedium('movie',0,null);
 let id=0;
 const add=(features:TasteFeatures,rating:number|null)=>{
  model.add({features,work:{id:String(++id),kind:'movie',medium:'movie',rating,explicit:0,implicit:3,consumed:true,repeated:false,chosen:true}});
 };
 const by=(people:typeof person)=>Object.fromEntries(roles.map(role=>[role,people]));
 for(let i=0;i<30;i++)add({...by(other),genres},options.otherRating??2);
 for(const rating of ratings)add({...by(person),...(options.franchise?{franchises:[{id:'f',name:'Series'}]}:{})},rating);
 if(options.veto)for(let i=0;i<3;i++)add({...by(person),genres},1);
 const {reference}=await model.finish();
 return scorerFromReference(reference,true);
}
for(const role of roleList)test('consistent high ratings can make '+role+' lead the match',async()=>{
 const score=await example([role],Array(8).fill(5));
 const fit=score({genres,[role]:person}),signals=fit.breakdown!.signals;
 expect(signals[0].dimension).toBe(role);
 expect(signals[0].evidence[0].creator).toEqual({liked:8,rated:8,independent:8});
 expect(fit.score!).toBeGreaterThan(50);
 expect(score({genres}).score!).toBeLessThan(50);
});

test('creator promotion needs selective, independent high ratings and respects contrary joint feedback',async()=>{
 for(const [ratings,options] of [
  [[5,5],{}],[Array(12).fill(5),{franchise:true}],[Array(20).fill(null),{}],
  [[5,1,5,1,5,1],{}],[Array(8).fill(5),{otherRating:5}],
 ] as const){
  const score=await example(['writers'],[...ratings],options);
  expect(score({writers:person,genres}).breakdown!.signals.flatMap(s=>s.evidence).some(e=>e.creator)).toBe(false);
 }
 const score=await example(['directors'],Array(16).fill(5),{veto:true});
 expect(score({directors:person}).breakdown!.signals[0].evidence[0].creator).toBeDefined();
 expect(score({directors:person,genres}).breakdown!.signals.flatMap(s=>s.evidence).every(e=>!e.creator)).toBe(true);
});
test('one person writing and directing does not get two creator boosts',async()=>{
 const score=await example(roleList,Array(8).fill(5));
 const direct=score({directors:person,genres});
 const both=score({directors:person,writers:person,genres});
 expect(both.score).toBe(direct.score);
 expect(both.confidence).toBe(direct.confidence);
 expect(both.reasons.filter(r=>r.name==='Creator')).toHaveLength(1);
});
