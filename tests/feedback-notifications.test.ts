import {expect,test} from 'bun:test';
import {createFeedbackNotifications,type FeedbackRecord} from '../src/lib/ui/controls/feedback-notifications';
const record=(id:string,text=id):FeedbackRecord=>({id,text,kind:'info',pending:false});
const settle=async()=>{for(let count=0;count<8;count++)await Promise.resolve();};
function fixture(){
 let viewer:string|undefined='one',online:(()=>void)|undefined,failures=0,full=0,changes=0;
 const requests:{viewer:string;notices:FeedbackRecord[];signal:AbortSignal;resolve:()=>void;reject:()=>void}[]=[];
 const owner=createFeedbackNotifications({viewer:()=>viewer,
  save:(viewer,notices,signal)=>new Promise<void>((resolve,reject)=>requests.push({viewer,notices,signal,resolve,reject:()=>reject(Error('Unavailable'))})),
  failure:(_retry,overflow)=>{failures++;if(overflow)full++;},recovered:()=>{},changed:()=>{changes++;},
  online:retry=>{online=retry;return()=>{online=undefined;};}});
 return {owner,requests,setViewer:(next:string|undefined)=>{viewer=next;},online:()=>online?.(),get failures(){return failures;},get full(){return full;},get changes(){return changes;}};
}
test('feedback writes batch and retain latest pending/error context with one lane and stable retry identities',async()=>{
 const f=fixture(),stop=f.owner.connect();try{
  for(let index=0;index<25;index++)f.owner.record(record(String(index)));
  await settle();expect(f.requests).toHaveLength(1);expect(f.requests[0].notices).toHaveLength(20);
  f.owner.record({id:'0',text:'Failed later',kind:'error',pending:false});
  f.requests[0].reject();await settle();expect(f.failures).toBe(1);expect(f.requests).toHaveLength(1);
  const retry=f.owner.retry();expect(f.requests[1].notices.find(notice=>notice.id==='0')).toMatchObject({text:'Failed later',kind:'error'});
  expect(new Set(f.requests[1].notices.map(notice=>notice.id)).size).toBe(20);
  f.requests[1].resolve();await retry;await settle();expect(f.requests).toHaveLength(3);f.requests[2].resolve();await settle();expect(f.owner.pending).toBe(0);
 }finally{stop();}
});
test('published inbox persistence has no toast-dismiss lifetime and account replacement fences late results',async()=>{
 const f=fixture(),stop=f.owner.connect();
 f.owner.record(record('before-X'));await settle();expect(f.requests[0].signal.aborted).toBe(false);
 // Clearing or expiring the presentation has no port into this write owner.
 await settle();expect(f.owner.pending).toBe(1);expect(f.requests[0].signal.aborted).toBe(false);
 f.setViewer('two');f.owner.record(record('new-account'));await settle();
 expect(f.requests[0].signal.aborted).toBe(true);expect(f.requests[1].viewer).toBe('two');
 f.requests[0].reject();await settle();expect(f.failures).toBe(0);
 f.requests[1].resolve();await settle();expect(f.changes).toBe(1);stop();
});
test('unowned feedback is not replayed to a later login; reconnect retries only retained owner data',async()=>{
 const f=fixture();f.setViewer(undefined);const stop=f.owner.connect();
 f.owner.record(record('anonymous'));await settle();expect(f.requests).toEqual([]);
 f.setViewer('one');f.owner.record(record('owned'));await settle();f.requests[0].reject();await settle();
 f.online();await settle();expect(f.requests).toHaveLength(2);expect(f.requests[1].notices.map(notice=>notice.id)).toEqual(['owned']);
 f.requests[1].resolve();await settle();stop();
});
test('the tab backlog is bounded and overflow reports once without recursive records',async()=>{
 const f=fixture(),stop=f.owner.connect();try{
  for(let index=0;index<250;index++)f.owner.record(record(String(index)));
  await settle();expect(f.owner.pending).toBe(200);expect(f.full).toBe(1);expect(f.requests).toHaveLength(1);
  f.requests[0].reject();await settle();expect(f.owner.pending).toBe(200);expect(f.requests).toHaveLength(1);
 }finally{stop();expect(f.owner.pending).toBe(0);}
});
