import {test,expect} from 'bun:test';
import {tasteSignals,median,type TasteWork} from '../src/lib/social/taste';
const works=(rating=5,reaction='❤️'):TasteWork[]=>Array.from({length:5},(_,i)=>({id:String(i),rating,reaction,genres:['Drama'],interest:true,consumed:true}));
test('taste keeps independent signals and blends qualifying samples',()=>{
 const result=tasteSignals(works(),works(2.5,'😂'));
 expect(result.signals.ratings.score).toBeCloseTo(100*(1-2.5/4.5));expect(result.signals.reactions.score).toBe(0);
 expect(result.signals.genres.score).toBe(100);expect(result.signals.interests.score).toBe(100);expect(result.score).toBeCloseTo(result.signals.ratings.score!*0.4+40);
});
test('negatively rated titles do not establish a shared positive genre preference',()=>{
 const result=tasteSignals(works(),works(0.5,'😂'));
 expect(result.signals.ratings.score).toBe(0);expect(result.signals.reactions.score).toBe(0);
 expect(result.signals.genres.score).toBeNull();expect(result.signals.interests.score).toBe(100);
 expect(result.score).toBeCloseTo(100*10/70);
});
test('missing and sparse signals are excluded, never disagreements',()=>{
 const a=works().map(w=>({...w,rating:null,reaction:null}));
 expect(tasteSignals(a,a).score).toBe(100);
 expect(tasteSignals(a.slice(0,4),a.slice(0,4)).score).toBe(null);
 expect(median([90,50,70])).toBe(70);expect(median([10,100])).toBe(55);expect(median([])).toBe(null);
});

 test('Trakt profile icons use the authenticated account settings response',async()=>{
  const {TraktAdapter}=await import('../src/lib/providers/trakt/adapter.server');
  const adapter=new TraktAdapter(async path=>{
   expect(path).toBe('/users/settings');return {user:{username:'Fixture',ids:{uuid:'fixture-stable-uuid',slug:'fixture'},images:{avatar:{full:'https://walter-r2.trakt.tv/images/users/fixture.webp'}}}};
  },'fixture','fixture');
  expect(await adapter.profile()).toMatchObject({id:'fixture-stable-uuid',avatar:'https://walter-r2.trakt.tv/images/users/fixture.webp'});
 });
