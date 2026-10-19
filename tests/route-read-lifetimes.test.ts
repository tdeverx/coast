import {expect,test} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,componentScript,moduleUrl,resourceUrl,svelteUrl} from './fixtures/ui-script';

const profileScript=(await componentScript('src/routes/profile/[username]/+page.svelte')).replace('let { data } = $props();','');
const onboardingScript=(await componentScript('src/routes/onboarding/+page.svelte'))
 .replace(/\bimport\s*[\s\S]*?\bfrom\s*['"][^'"]+['"];?/g,'').replace('let {data,form}=$props();','');
const {createProfile,createOnboarding}=await import(moduleUrl(compileRunes(`
 import {untrack} from ${JSON.stringify(svelteUrl)};
 import {createResource} from ${JSON.stringify(resourceUrl)};
 export function createProfile(initial,api,change){
  let data=$state(initial);const cleanups=[],onDestroy=callback=>cleanups.push(callback);
  const setContext=()=>{},reportFailure=()=>{},page={url:new URL('https://example.invalid/profile/owner')};
  const message=error=>error.message;
  ${profileScript}
  return {chooseFavourites,choosePeriod,setData(next){data=next;},dispose(){cleanups.forEach(cleanup=>cleanup());},
   get favourites(){return favouriteData;},get insights(){return insights;},get favouriteKind(){return favouriteKind;},
   get favouriteLoading(){return favouriteLoading;},get insightLoading(){return insightLoading;},
   get favouriteError(){return favouriteError;},get insightError(){return insightError;}};
 }
 export function createOnboarding(initial,initialForm,fetch,refreshRouteDependencies,deserialize=JSON.parse){
  let data=$state(initial),form=$state(initialForm);const mounts=[],onMount=callback=>mounts.push(callback);
  const reportFailure=()=>{};
  ${onboardingScript}
  return {get error(){return deviceError;},setForm(next){form=next;},setData(next){data=next;},
   mount(){const cleanups=mounts.map(callback=>callback());return()=>cleanups.forEach(cleanup=>cleanup?.());}};
 }
`,'route-read-lifetimes.svelte.js')));

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const settle=async()=>{for(let index=0;index<12;index++)await Promise.resolve();runtime.flush();};
const favouriteResult=(tag:string,count=1)=>({favourites:Array.from({length:count},(_,index)=>({id:tag+index})),page:1,pages:1,total:count});
const profileData=(tag='initial',isOwner=false)=>({username:'owner',isOwner,view:'overview',...favouriteResult(tag),
 filters:{kind:'all',period:'all',activityKind:'all',query:''},totals:{unique:0,watches:0,episodes:0,rated:0},
 activity:Promise.resolve({tag}),profile:{displayName:''},background:null});

test('profile independent reads cancel superseded selections and preserve latest results and existing caps',async()=>{
 const requests:{path:string;signal:AbortSignal;wait:ReturnType<typeof deferred<any>>}[]=[];let controller:any;
 const dispose=runtime.effect_root(()=>controller=createProfile(profileData(),(path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
  const request={path,signal:options.signal,wait:deferred<any>()};requests.push(request);return request.wait.promise;
 },()=>{throw Error('A visitor must not write preferences');}));
 try{runtime.flush();const first=controller.chooseFavourites('movie'),stats=controller.choosePeriod('year');
  expect(requests).toHaveLength(2);expect(requests[0].signal.aborted).toBe(false);expect(requests[1].signal.aborted).toBe(false);
  const latest=controller.chooseFavourites('comic');expect(requests[0].signal.aborted).toBe(true);expect(requests[1].signal.aborted).toBe(false);
  expect(requests[2].path).toContain('kind=comic&scope=all');expect(controller.favouriteKind).toBe('comic');
  requests[2].wait.resolve(favouriteResult('new',30));await latest;expect(controller.favourites.favourites).toHaveLength(20);
  requests[0].wait.resolve(favouriteResult('stale'));await first;expect(controller.favourites.favourites[0].id).toBe('new0');
  requests[1].wait.resolve({totals:{unique:7},activity:{tag:'new-stats'}});await stats;expect(controller.insights.totals.unique).toBe(7);
  expect(controller.favouriteLoading).toBe(false);expect(controller.insightLoading).toBe(false);
 }finally{controller.dispose();dispose();}
});

test('profile insight context stays with its values through pending, failed and superseded periods',async()=>{
 const requests:{wait:ReturnType<typeof deferred<any>>}[]=[];let controller:any;
 const dispose=runtime.effect_root(()=>controller=createProfile(profileData(),()=>{
  const request={wait:deferred<any>()};requests.push(request);return request.wait.promise;
 },()=>{throw Error('A visitor must not write preferences');}));
 try{runtime.flush();expect(controller.insights.period).toBe('all');
  const first=controller.choosePeriod('month');expect(controller.insights.period).toBe('all');
  requests[0].wait.reject(Error('unavailable'));await first;expect(controller.insights.period).toBe('all');
  expect(controller.insightError).toBe('unavailable');
  const stale=controller.choosePeriod('year'),latest=controller.choosePeriod('month');
  expect(controller.insights.period).toBe('all');
  requests[2].wait.resolve({totals:{watches:17},activity:{tag:'month'}});await latest;
  expect(controller.insights.period).toBe('month');expect(controller.insights.totals.watches).toBe(17);
  requests[1].wait.resolve({totals:{watches:55},activity:{tag:'year'}});await stale;
  expect(controller.insights.period).toBe('month');expect(controller.insights.totals.watches).toBe(17);
  controller.setData({...profileData('replacement'),filters:{...profileData().filters,period:'year'}});runtime.flush();
  expect(controller.insights.period).toBe('year');expect(controller.insights.totals.watches).toBe(0);
 }finally{controller.dispose();dispose();}
});

test('profile server replacements and teardown abort both lanes without stale errors or publication',async()=>{
 const requests:{signal:AbortSignal;wait:ReturnType<typeof deferred<any>>}[]=[];let controller:any;
 const dispose=runtime.effect_root(()=>controller=createProfile(profileData(),(_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
  const request={signal:options.signal,wait:deferred<any>()};requests.push(request);return request.wait.promise;
 },async()=>{}));
 try{runtime.flush();const first=controller.chooseFavourites('movie'),stats=controller.choosePeriod('month');
  controller.setData(profileData('server'));runtime.flush();expect(requests.every(request=>request.signal.aborted)).toBe(true);
  requests[0].wait.resolve(favouriteResult('late'));requests[1].wait.reject(Error('late error'));await Promise.all([first,stats]);
  expect(controller.favourites.favourites[0].id).toBe('server0');expect(controller.insightError).toBe('');
  const last=controller.chooseFavourites('show');controller.dispose();expect(requests[2].signal.aborted).toBe(true);
  requests[2].wait.reject(Error('late after teardown'));await last;expect(controller.favouriteError).toBe('');
  await controller.choosePeriod('year');expect(requests).toHaveLength(3);
 }finally{controller.dispose();dispose();}
});

test('profile preference writes remain ordered and acknowledged despite superseded read cancellation',async()=>{
 const reads:{signal:AbortSignal;wait:ReturnType<typeof deferred<any>>}[]=[],writes:{body:any;wait:ReturnType<typeof deferred<void>>}[]=[];let controller:any;
 const dispose=runtime.effect_root(()=>controller=createProfile(profileData('initial',true),(_path:string,_body:unknown,_method:string,options:{signal:AbortSignal})=>{
  const request={signal:options.signal,wait:deferred<any>()};reads.push(request);return request.wait.promise;
 },(_path:string,body:any)=>{const write={body,wait:deferred<void>()};writes.push(write);return write.wait.promise;}));
 try{runtime.flush();const first=controller.chooseFavourites('movie'),second=controller.chooseFavourites('show');await settle();
  expect(reads[0].signal.aborted).toBe(true);expect(writes.map(write=>write.body.favouriteKind)).toEqual(['movie']);
  reads[1].wait.resolve(favouriteResult('show'));await settle();expect(controller.favouriteLoading).toBe(true);
  writes[0].wait.resolve();await settle();expect(writes.map(write=>write.body.favouriteKind)).toEqual(['movie','show']);
  writes[1].wait.resolve();reads[0].wait.resolve(favouriteResult('movie'));await Promise.all([first,second]);
  expect(controller.favourites.favourites[0].id).toBe('show0');expect(controller.favouriteLoading).toBe(false);
 }finally{controller.dispose();dispose();}
});

function browser(){
 const original={document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval,now:Date.now};
 const timers=new Set<()=>void>(),listeners=new Set<()=>void>();let now=100_000;
 const document={hidden:false,addEventListener:(type:string,callback:()=>void)=>{expect(type).toBe('visibilitychange');listeners.add(callback);},
  removeEventListener:(type:string,callback:()=>void)=>{expect(type).toBe('visibilitychange');listeners.delete(callback);}};
 globalThis.document=document as unknown as Document;
 globalThis.setInterval=((callback:()=>void)=>{timers.add(callback);return callback;}) as unknown as typeof setInterval;
 globalThis.clearInterval=((callback:()=>void)=>timers.delete(callback)) as unknown as typeof clearInterval;
 Date.now=()=>now;
 return {document,timers,listeners,tick:()=>timers.forEach(callback=>callback()),advance:(ms:number)=>{now+=ms;},visible:(hidden:boolean)=>{document.hidden=hidden;listeners.forEach(callback=>callback());},
  restore(){globalThis.document=original.document;globalThis.setInterval=original.setInterval;globalThis.clearInterval=original.clearInterval;Date.now=original.now;}};
}
const onboardingData=(phase='connections')=>({profile:{avatar:null},requiredProvider:'none',traktLinked:false,linked:false,phase});
const deviceForm=(instanceId='one')=>({device:{instanceId,interval:5}});
const action=(result:unknown)=>({text:async()=>JSON.stringify(result)});

test('onboarding aborts the owned device wait on teardown and ignores a late successful body',async()=>{
 const env=browser(),response=deferred<any>();let controller:any,signal!:AbortSignal,refreshes=0,calls=0,bodies=0,cleanup=()=>{};
 const dispose=runtime.effect_root(()=>controller=createOnboarding(onboardingData('importing'),deviceForm(),(_path:string,options:{signal:AbortSignal})=>{calls++;signal=options.signal;return response.promise;},async()=>{refreshes++;}));
 try{runtime.flush();cleanup=controller.mount();env.tick();env.tick();expect(calls).toBe(1);expect(signal.aborted).toBe(false);
  cleanup();expect(signal.aborted).toBe(true);expect(env.timers.size).toBe(0);expect(env.listeners.size).toBe(0);
  response.resolve({text:async()=>{bodies++;return JSON.stringify({type:'success',data:{pending:false}});}});await settle();expect(bodies).toBe(0);expect(refreshes).toBe(0);expect(controller.error).toBe('');
  env.tick();expect(calls).toBe(1);
 }finally{cleanup();dispose();env.restore();}
});

test('onboarding pauses hidden import refreshes and resumes one bounded refresh when visible',async()=>{
 const env=browser(),wait=deferred<void>();let controller:any,refreshes=0,cleanup=()=>{};
 const dispose=runtime.effect_root(()=>controller=createOnboarding(onboardingData('importing'),null,()=>{throw Error('No device code');},()=>{refreshes++;return wait.promise;}));
 try{runtime.flush();cleanup=controller.mount();env.visible(true);env.tick();await settle();expect(refreshes).toBe(0);
  env.visible(false);expect(refreshes).toBe(1);env.tick();env.visible(false);expect(refreshes).toBe(1);
  cleanup();wait.reject(Error('admitted invalidation finished after teardown'));await settle();expect(controller.error).toBe('');expect(refreshes).toBe(1);
 }finally{cleanup();dispose();env.restore();}
});

test('onboarding device completion and import polling retain their shared onboarding dependency',async()=>{
 const env=browser(),refreshes:string[][]=[];let controller:any,cleanup=()=>{};
 const dispose=runtime.effect_root(()=>controller=createOnboarding(onboardingData(),deviceForm(),async()=>action({type:'success',data:{pending:false}}),async(dependencies:string[])=>{refreshes.push(dependencies);}));
 try{
  runtime.flush();cleanup=controller.mount();env.tick();await settle();expect(refreshes).toEqual([['onboarding']]);
  controller.setForm(null);controller.setData(onboardingData('importing'));runtime.flush();env.tick();await settle();expect(refreshes).toEqual([['onboarding'],['onboarding']]);expect(controller.error).toBe('');
 }finally{cleanup();dispose();env.restore();}
});

test('onboarding does not deserialize an action body that finishes after its owner is disposed',async()=>{
 const env=browser(),body=deferred<string>();let controller:any,decodes=0,refreshes=0,cleanup=()=>{};
 const dispose=runtime.effect_root(()=>controller=createOnboarding(onboardingData(),deviceForm(),async()=>({text:()=>body.promise}),async()=>{refreshes++;},(text:string)=>{decodes++;return JSON.parse(text);}));
 try{runtime.flush();cleanup=controller.mount();env.tick();await settle();cleanup();body.resolve('not a valid action response');await settle();
  expect(decodes).toBe(0);expect(refreshes).toBe(0);expect(controller.error).toBe('');
 }finally{cleanup();dispose();env.restore();}
});

test('onboarding device authorization keeps polling while hidden at the provider interval and reports failures',async()=>{
 const env=browser();let controller:any,calls=0,refreshes=0,cleanup=()=>{};
 const dispose=runtime.effect_root(()=>controller=createOnboarding(onboardingData(),deviceForm(),async()=>{calls++;return action(calls===1?{type:'success',data:{pending:true}}:{type:'failure',data:{error:'Code expired'}});},async()=>{refreshes++;}));
 try{runtime.flush();cleanup=controller.mount();env.visible(true);env.tick();await settle();expect(calls).toBe(1);
  env.advance(4000);env.tick();await settle();expect(calls).toBe(1);env.advance(1000);env.tick();await settle();expect(calls).toBe(2);
  expect(controller.error).toBe('Code expired');expect(refreshes).toBe(0);env.advance(5000);env.tick();await settle();expect(calls).toBe(2);
 }finally{cleanup();dispose();env.restore();}
});

test('onboarding ignores a superseded code response and preserves current transport error feedback',async()=>{
 const env=browser(),response=deferred<any>();let controller:any,calls=0,cleanup=()=>{};
 const dispose=runtime.effect_root(()=>controller=createOnboarding(onboardingData(),deviceForm(),()=>{calls++;return calls===1?response.promise:Promise.reject(Error('network failed'));},async()=>{}));
 try{runtime.flush();cleanup=controller.mount();env.tick();controller.setForm(deviceForm('two'));runtime.flush();
  response.resolve(action({type:'failure',data:{error:'Old code expired'}}));await settle();expect(controller.error).toBe('');
  env.advance(5000);env.tick();await settle();expect(controller.error).toBe('Connection interrupted. Try connecting again.');
 }finally{cleanup();dispose();env.restore();}
});
