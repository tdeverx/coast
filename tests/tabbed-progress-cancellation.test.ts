import {expect,test} from 'bun:test';
import * as v from 'valibot';
import type {SQL} from 'bun';
import {progressOptionsSchema,progressSelectionTabs} from '../src/lib/progress';
import {cancellableReads,withReadCancellation} from '../src/lib/server/db/read-cancellation';

// Execute the production tabbed read owner with a held native-shaped summary
// query. Its dependencies are isolated; cancellation/Request ownership are real.
const source=await Bun.file('src/lib/server/queries/progress.ts').text();
const start=source.indexOf('export async function tabbedProgressData');
const end=source.indexOf('\nasync function readProgressData',start);
const code=new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(start,end).replace('export ',''));
function owner(summary:()=>Promise<boolean>,hydrate:()=>Promise<unknown>){
 const dependencies={v,progressOptionsSchema,progressSelectionTabs,withReadCancellation,
  createScreenProgressPlanning:()=>()=>{},
  screenProgressPresent:(_user:string,_viewer:string,view:string)=>view==='watching'?summary():Promise.resolve(false),
  pausedProgressPresent:async()=>false,profileProgressPresence:async()=>({finished:false,dropped:false}),
  readProgressData:hydrate,progressData:hydrate,requireVisible:async()=>{throw Error('Unexpected private read');}};
 return Function(...Object.keys(dependencies),code+';return tabbedProgressData;')(...Object.values(dependencies)) as
  (owner:string,raw:unknown,viewer:string,surface:'continue'|'profile',signal?:AbortSignal)=>Promise<unknown>;
}

test('a genuine Request cancellation cancels its held tab summary and admits no page hydration',async()=>{
 let release!:()=>void,reject!:(reason:unknown)=>void,entered!:()=>void;
 let summaries=0,cancellations=0,hydrations=0;
 const started=new Promise<void>(yes=>{entered=yes;});
 const held=Object.assign(new Promise<boolean>((yes,no)=>{release=()=>yes(true);reject=no;}),{
  cancel(){cancellations++;reject(new DOMException('Summary cancelled','AbortError'));},
 });
 const native=cancellableReads({unsafe(){summaries++;entered();return held;}} as unknown as SQL);
 const read=owner(async()=>await native.unsafe('held summary') as unknown as boolean,async()=>{hydrations++;return {items:[]};});
 const controller=new AbortController(),request=new Request('https://coast-fixture.invalid/progress?segments=profile',{signal:controller.signal});
 const pending=read('owner',{},'owner','profile',request.signal);void pending.catch(()=>{});
 await started;controller.abort();
 await expect(pending).rejects.toMatchObject({name:'AbortError'});
 release();await Promise.resolve();
 expect({summaries,cancellations,hydrations}).toEqual({summaries:1,cancellations:1,hydrations:0});
 await expect(read('owner',{},'owner','profile',request.signal)).rejects.toMatchObject({name:'AbortError'});
 expect(summaries).toBe(1);
});

test('an uncancelled tab summary hydrates exactly one retained page',async()=>{
 let summaries=0,hydrations=0;
 const read=owner(async()=>{summaries++;return true;},async()=>{hydrations++;return {view:'watching',items:['retained']};});
 const request=new Request('https://coast-fixture.invalid/progress?segments=continue');
 expect(await read('owner',{},'owner','continue',request.signal)).toMatchObject({items:['retained'],availableViews:['watching']});
 expect({summaries,hydrations}).toEqual({summaries:1,hydrations:1});
});

test('API and SSR tabbed owners forward their actual Request signal',async()=>{
 const api=await Bun.file('src/lib/server/api/index.server.ts').text();
 const route=await Bun.file('src/routes/progress/+page.server.ts').text();
 expect(api).toContain('tabbedProgressData(subjectId,options,uid,segments,request.signal)');
 expect(route).toContain("tabbedProgressData(subject.id,options.output,locals.user.id,'profile',request.signal)");
});
