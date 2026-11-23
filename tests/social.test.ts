import {test,expect} from 'bun:test';
import {sharedTasteSignals,median,type SharedTasteEvidence} from '../src/lib/social/taste';

test('overall taste uses the median across qualifying media',()=>{
 expect(median([90,50,70])).toBe(70);expect(median([10,100])).toBe(55);expect(median([])).toBe(null);
});

 test('Trakt profile icons use the authenticated account settings response',async()=>{
  const {TraktAdapter}=await import('../src/lib/providers/trakt/adapter.server');
  const adapter=new TraktAdapter(async path=>{
   expect(path).toBe('/users/settings');return {user:{username:'Fixture',ids:{uuid:'fixture-stable-uuid',slug:'fixture'},images:{avatar:{full:'https://walter-r2.trakt.tv/images/users/fixture.webp'}}}};
  },'fixture','fixture');
  expect(await adapter.profile()).toMatchObject({id:'fixture-stable-uuid',avatar:'https://walter-r2.trakt.tv/images/users/fixture.webp'});
 });

test('shared rating order preserves tied ranks, including repeated pairs beyond a sample limit',()=>{
 const stats={you:{rated:606,reacted:0},friend:{rated:606,reacted:0}};
 const order=(cells:NonNullable<SharedTasteEvidence['ratings']>)=>sharedTasteSignals({
  ratings:cells,works:cells.reduce((n,c)=>n+c[2],0),score:null,reactionWorks:0,reactionScore:null
 },stats).ratingOrder.score;
 expect(order([[1,2,202],[2,3,101],[3,4,202],[4,5,101]])).toBe(100);
 expect(order([[1,5,202],[2,4,101],[3,3,202],[4,2,101]])).toBe(0);
 expect(order([[1,5,303],[2,5,303]])).toBeNull();
 expect(order([[1,1,1],[2,2,1],[3,3,1]])).toBeNull();
});
