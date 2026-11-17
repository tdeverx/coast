import {expect,test} from 'bun:test';
import {compileRunes,componentScript,moduleUrl} from './fixtures/ui-script';

const source=(await componentScript('src/lib/ui/components/FriendRoster.svelte')).replaceAll('$props()','properties');
const factory=await import(moduleUrl(compileRunes(`
 const useClock=()=>({now:0});
 export function create(properties){
  ${source}
  return {stage(value){removal=value;},removeFriend,viewer(value){userId=value;},busy(value){busy=value;},get pending(){return removal;}};
 }
`)));
const selected={friendId:'relationship-a',targetUserId:'alice',username:'Alice',viewerId:'viewer'};
const friend={id:'relationship-a',userId:'alice',state:'accepted'};

test('friend removal sends only the explicitly confirmed relationship once',()=>{
 const writes:unknown[]=[];
 const menu=factory.create({friends:[friend],userId:'viewer',act:(...args:unknown[])=>writes.push(args)});
 menu.stage(selected);
 menu.removeFriend();
 expect(writes).toEqual([['social/friends/relationship-a',{action:'remove'}]]);
 expect(menu.pending).toBeUndefined();
 menu.removeFriend();
 expect(writes).toHaveLength(1);
});

test('friend removal refuses stale targets, changed viewers and pending operations',()=>{
 const friends=[{...friend}],writes:unknown[]=[];
 const menu=factory.create({friends,userId:'viewer',act:(...args:unknown[])=>writes.push(args)});
 menu.stage(selected);
 friends[0]={...friend,userId:'bob'};
 menu.removeFriend();
 expect(writes).toHaveLength(0);
 friends[0]={...friend};
 menu.viewer('another-viewer');
 menu.removeFriend();
 expect(writes).toHaveLength(0);
 menu.viewer('viewer');menu.busy(true);
 menu.removeFriend();
 expect(writes).toHaveLength(0);
});
